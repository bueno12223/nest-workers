import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common'
import { Worker } from 'worker_threads'
import * as os from 'os'
import { WORKER_OPTIONS_TOKEN } from './constants'
import { WorkerOptions } from './types'

export * from './constants'

/**
 * Service to manage a pool of workers and distribute tasks to them
 * * @class
 * @implements {OnModuleDestroy}
 * @param scriptPath Path to the worker script
 * @param workerOptions Options to pass to the worker
 * @param maxWorkers Maximum number of workers to spawn
 * @param maxTasks Maximum number of tasks a worker can complete before being restarted
 * @param maxLifetime Maximum amount of time a worker can be alive before being restarted
 * @param taskQueueLimit Maximum number of tasks that can be queued while all workers are busy
*/
@Injectable()
export class WorkerPoolService implements OnModuleDestroy {
	/**
   * Pool of workers
   * @private
   * @type {Worker[]}
   */
	private workerPool: Worker[] = []
	/**
   * Maximum number of workers to spawn
   * @private
   * @type {number}
   */
	private maxWorkers: number = os.cpus().length   
	/**
   * Set of currently active workers
   * @private
   * @type {Set<Worker>}
   */
	private activeWorkers: Set<Worker> = new Set()
	/**
	 * Map of worker creation times
	 * @private
	 * @type {Map<Worker, number>}
	 * */
	private workerCreationTimes: Map<Worker, number> = new Map<Worker, number>()
	/**
	 * Map of worker task counts
	 * @private
	 * @type {Map<Worker, number>}
	 * */
	private workerTaskCount: Map<Worker, number> = new Map<Worker, number>()
	/**
	 * Map of worker current tasks
	 * @private
	 * @type {Map<Worker, unknown>}
	 * */
	private workerCurrentTask: Map<Worker, unknown> = new Map<Worker, unknown>()
	/**
	 * Array of pending tasks, this is only used when a worker is being restarted and the task was not completed
	 * @private
	 * @type {unknown[]}
	 * */
	private pendingTasksResolvers: ((value: unknown | PromiseLike<unknown>) => void)[] = []


	/**
	 * Maximum number of tasks a worker can complete before being restarted
	 * @private
	 * @type {number}
	 * */
	private workerMaxTasks = 100
	/**
	 * Maximum amount of time a worker can be alive before being restarted
	 * @private
	 * @type {number}
	 * */
	private workerMaxLifetime = 2 * 60 * 60 * 1000

	/**
     * Verbose flag for logging detailed information
     * @private
     * @type {boolean}
     */
	private verbose = false
    
	constructor(@Inject(WORKER_OPTIONS_TOKEN) private workerOptions: WorkerOptions<unknown>) {
		this.maxWorkers = workerOptions?.maxWorkers ?? os.cpus().length
		this.workerMaxTasks = workerOptions?.maxTasks ?? 100
		this.workerMaxLifetime = workerOptions?.maxLifetime ?? 2 * 60 * 60 * 1000
		this.verbose = workerOptions?.verbose ?? false
		this.initWorkerPool()
	}

	private log(...args: unknown[]) {
		if (this.verbose) {
			console.log(...args)
		}
	}

	private initWorkerPool() {
		this.log(`Initializing worker pool with maxWorkers: ${this.maxWorkers}`)
		for (let i = 0; i < this.maxWorkers; i++) {
			this.addNewWorkerToPool()
		}
	}
    
	private addNewWorkerToPool() {
		this.log('Adding new worker to pool')
		if(this.workerPool.length >= this.maxWorkers) {
			return
		}
		const worker = new Worker(this.workerOptions.scriptPath, this.workerOptions.workerOptions)
		this.workerCreationTimes.set(worker, Date.now())

		worker.on('exit', (code) => {
			this.log(`Worker exited with code ${code}`)
			if (code !== 0) {
				console.error(`Worker stopped with exit code ${code}`)
			}
			this.replenishWorkerPool()
		})

		this.setupWorkerListeners(worker)
		this.workerPool.push(worker)
		this.notifyWorkerAvailable(worker)
	}

	private replenishWorkerPool() {
		if (this.workerPool.length + this.activeWorkers.size < this.maxWorkers) {
			this.log('Replenishing worker pool', this.workerPool.length, this.activeWorkers.size, this.maxWorkers)
		  this.addNewWorkerToPool()
		}
	  }

	  private notifyWorkerAvailable(worker: Worker) {
		this.log('Notifying worker available', worker.threadId)
		if (this.pendingTasksResolvers.length > 0) {
		  const worker = this.workerPool.pop()
		  if (worker) {
				const resolve = this.pendingTasksResolvers.shift()
				console.log('Resolving pending task', resolve, worker.threadId)
				resolve?.(worker)
		  }
		}
	  }
	  

    
	private setupWorkerListeners(worker: Worker): void {
		const eventsMetadataKeys = Reflect.getMetadataKeys(this.constructor).filter((key) => key.startsWith('worker:'))
		eventsMetadataKeys.forEach((key) => {
			const { handler, once } = Reflect.getMetadata(key, this.constructor)
			if(!handler || !once) return
			if (typeof this[handler as keyof this] === 'function') {
				const boundHandler = (this[handler as keyof this] as (...args: unknown[]) => void).bind(this)
            
				if (once) {
					worker.once(key, (...args) => {
						boundHandler(...args)
						worker.removeAllListeners(key)
					})
				}
				else {
					worker.on(key, boundHandler)
				}
			}
		})
	}

	private async waitUntilWorkerAvailable(): Promise<Worker> {
		return new Promise((resolve) => {
			if (this.workerPool.length > 0) {
				const worker = this.workerPool.pop()
				if (worker) {
					return resolve(worker)
				}
			}
			setTimeout(() => {
				this.waitUntilWorkerAvailable().then((worker) => resolve(worker))
			}, 100)
			return null
		})
	}

	/**
	 * Run a task on a worker
	 * @param data Data to pass to the worker
	 * @returns {Promise<TResponse>} Promise that resolves with the result of the task
	 * */
	runTask<TParam>(data: TParam): Promise<boolean> {
		return new Promise(async(resolve, reject) => {
			const worker = this.workerPool.pop()


			if (!worker) {
				this.log('No workers available')
				if(this.workerOptions.waitUntilAvailable) {
					this.pendingTasksResolvers.push(resolve)
					return resolve(true)
				}
				else {
					return reject(new Error('No workers available'))
				}
			}
			this.log('Running task', worker.threadId, data)
			this.activeWorkers.add(worker)
			this.workerCurrentTask.set(worker, data) 
			const messageHandler = async() => {
				worker.removeListener('message', messageHandler)

				this.activeWorkers.delete(worker)
				this.workerCurrentTask.delete(worker)

				const taskCount = (this.workerTaskCount.get(worker) || 0) + 1
				this.workerTaskCount.set(worker, taskCount)

				if (this.shouldRestartWorker(worker)) {
					await this.restartWorker(worker).catch(reject)
				}
				else {
					this.workerPool.push(worker)
				}
				this.notifyWorkerAvailable(worker)
			}
			worker.once('message', messageHandler)
			worker.once('error', (err: Error) => {
				console.error(`Worker encountered an error: ${err.message}`)
				this.activeWorkers.delete(worker)
				this.restartWorker(worker).catch(reject)
				return reject(err)
			})
			worker.postMessage(data)
			return resolve(true)
		})
	}

	async runSyncTask<TParam, TResponse>(data: TParam): Promise<TResponse> {
		return new Promise(async(resolve, reject) => {
			const workerInPool = this.workerPool.pop()
			let worker: Worker


			if (!workerInPool) {
				this.log('No workers available')
				if(this.workerOptions.waitUntilAvailable) {
					this.log('Waiting for worker to become available', data)
					worker = await this.waitUntilWorkerAvailable()
					this.log('Worker available', worker.threadId, data)
				}
				else {
					return reject(new Error('No workers available'))
				}
			}
			else {
				worker = workerInPool
			}
			this.log('Running task', worker.threadId, data)
			this.activeWorkers.add(worker)
			this.workerCurrentTask.set(worker, data) 
			const messageHandler = async(data: TResponse) => {
				worker.removeListener('message', messageHandler)

				this.activeWorkers.delete(worker)
				this.workerCurrentTask.delete(worker)

				const taskCount = (this.workerTaskCount.get(worker) || 0) + 1
				this.workerTaskCount.set(worker, taskCount)

				if (this.shouldRestartWorker(worker)) {
					await this.restartWorker(worker).catch(reject)
				}
				else {
					this.workerPool.push(worker)
				}
				this.notifyWorkerAvailable(worker)
				this.log('Task completed', worker.threadId, data)
				return resolve(data)
			}
			worker.once('message', messageHandler)
			worker.once('error', (err: Error) => {
				console.error(`Worker encountered an error: ${err.message}`)
				this.activeWorkers.delete(worker)
				this.restartWorker(worker).catch(reject)
				return reject(err)
			})
			worker.postMessage(data)
			return worker
		})
	}



	/**
	 * Determine if a worker should be restarted, based on the number of tasks it has completed and how long it has been alive
	 * @param worker Worker to check
	 * @returns {boolean} True if the worker should be restarted
	 * */
	private shouldRestartWorker(worker: Worker): boolean {

		const tasksCompleted = this.workerTaskCount.get(worker) || 0
		if (tasksCompleted >= this.workerMaxTasks) {
			this.log('Worker has completed maximum number of tasks', worker.threadId)
			return true
		}

		const creationTime = this.workerCreationTimes.get(worker) || Date.now()
		if (Date.now() - creationTime >= this.workerMaxLifetime) {
			this.log('Worker has been alive for maximum lifetime', worker.threadId)
			return true
		}

		if (this.workerCurrentTask.has(worker)) {
			this.log('Worker has a current task, can not be restarted', worker.threadId)
			return true
		}

		return false
	}

	/**
	 * Wait for a worker to complete their current tasks
	 * @returns {Promise<boolean>} True if the worker is empty
	 * */
	async waitUntilWorkerEmpty(worker: Worker): Promise<boolean> {
		return new Promise((resolve) => {
			const checkWorker = () => {
				if (this.activeWorkers.has(worker)) {
					setTimeout(checkWorker, 100)
				}
				else {
					resolve(true)
				}
			}
			checkWorker()
		})
	}



	/**
	 * End a worker
	 * @param worker Worker to end
	 * @returns {Promise<boolean>} True if the worker was successfully ended
	 * */

	private async endWorker(worker: Worker): Promise<boolean> {
		this.log('Ending worker', worker.threadId)
		worker.removeAllListeners()
		await worker.terminate()
		this.workerTaskCount.delete(worker)
		this.workerCreationTimes.delete(worker)
		return true
	}

	private async restartWorker(worker: Worker): Promise<void> {
		this.log('Restarting worker', worker.threadId)
		await this.endWorker(worker)
		this.addNewWorkerToPool()
	}

	/**
	 * Set the maximum number of workers
	 * @param newMax New maximum number of workers
	 * @returns {boolean} True if the maximum number of workers was successfully set
	 * */
	setMaxWorkers(newMax: number): boolean {
		if (newMax < 1) {
		  throw new Error('Maximum number of workers must be at least 1')
		}
	
		this.maxWorkers = newMax
		this.adjustWorkerPool()
		return true
	}

	private adjustWorkerPool(): void {
		const currentPoolSize = this.workerPool.length + this.activeWorkers.size
		
		if (currentPoolSize < this.maxWorkers) {
		  while (this.workerPool.length + this.activeWorkers.size < this.maxWorkers) {
				this.addNewWorkerToPool()
		  }
		}
		else if (currentPoolSize > this.maxWorkers) {
		  let excessWorkers = currentPoolSize - this.maxWorkers
		  while (excessWorkers-- > 0 && this.workerPool.length > 0) {
				const workerToTerminate = this.workerPool.pop()
				if (workerToTerminate) {
					this.endWorker(workerToTerminate)
				}
		  }
		}
	  }

	onModuleDestroy() {
		this.workerPool.forEach(worker => {
			worker.removeAllListeners()
			worker.terminate()
		})
	}
}