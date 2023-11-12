import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common'
import { TransferListItem, Worker } from 'worker_threads'
import * as os from 'os'
import { WORKER_OPTIONS_TOKEN } from './constants'
import { WorkerOptions } from './types'
export * from './constants'
export * from './decorators'

/**
 * Service to manage a pool of workers and distribute tasks to them
 * * @class
 * @implements {OnModuleDestroy}
 * @param scriptPath Path to the worker script
 * @param workerOptions Options to pass to the worker
 * @param maxWorkers Maximum number of workers to spawn
 * @param maxTasks Maximum number of tasks a worker can complete before being restarted
 * @param maxLifetime Maximum amount of time a worker can be alive before being restarted
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

	/**
	 * Log a message if verbose is enabled
	 * @param args Arguments to log
	 * */
	private log(...args: unknown[]) {
		if (this.verbose) {
			console.log(...args)
		}
	}

	/**
	 * Initialize the worker pool
	 * @private
	 * */
	private initWorkerPool() {
		this.log(`Initializing worker pool with maxWorkers: ${this.maxWorkers}`)
		for (let i = 0; i < this.maxWorkers; i++) {
			this.addNewWorkerToPool()
		}
	}
    
	/**
	 * Add a new worker to the pool
	 * @private
	 * */
	private addNewWorkerToPool() {
		this.log('Adding new worker to pool')
		if(this.workerPool.length >= this.maxWorkers) {
			return
		}
		const worker = new Worker(this.workerOptions.scriptPath, this.workerOptions.workerOptions)
		this.workerCreationTimes.set(worker, Date.now())
		worker.on('exit', async (code) => {
			this.log(`Worker exited with code ${code}`)
			if (code !== 0) {
				console.error(`Worker stopped with exit code ${code}`)
			}
			worker.removeListener('message', this.handleWorkerMessage)

			this.activeWorkers.delete(worker)
			this.workerCurrentTask.delete(worker)
			await this.endWorker(worker)
			this.replenishWorkerPool()
		})

		this.setupWorkerListeners(worker)
		this.workerPool.push(worker)
		this.notifyWorkerAvailable(worker)
	}

	/**
	 * Replenish the worker pool
	 * @private
	 * */
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
				this.log('Resolving pending task', resolve, worker.threadId)
				resolve?.(worker)
		  }
		}
	  }
	  
    
	/**
	 * Setup listeners for a worker
	 * @private
	 * @param worker Worker to setup listeners for
	 * */
	private setupWorkerListeners(worker: Worker): void {
		const eventsMetadataKeys = Reflect.getMetadataKeys(this).filter((key) => key.startsWith('worker:'))
		eventsMetadataKeys.forEach((key) => {
			let { handler, once } = Reflect.getMetadata(key, this)
			if (typeof this[handler as keyof this] !== 'function') {
				const messageHandler = Reflect.getMetadata('worker:message', this)
				if (messageHandler && typeof this[messageHandler.handler as keyof this] === 'function') {
					handler = messageHandler.handler
					once = messageHandler.once
				}
			}
			if (typeof this[handler as keyof this] === 'function') {
				const boundHandler = (this[handler as keyof this] as (...args: unknown[]) => void).bind(this)
				const eventName = key.replace('worker:', '')
					
				if (once) {
					worker.once('message', (payload) => {
						if (typeof payload === 'object' && payload !== null && payload.type === eventName) {
							boundHandler(payload)
							return
						}
					})
				}
				else {
					worker.on('message', (payload) => {
						if (typeof payload === 'object' && payload !== null && payload.type === eventName) {
							boundHandler(payload)
							return
						}
					})
				}
			}
		})
	}


	/**
	 * Handle a message from a worker
	 * @private
	 * @param worker Worker that sent the message
	 * @param payload Payload of the message
	 * @param onSuccess Function to call if the task was successful
	 * @param onError Function to call if the task failed
	 * */
	private async handleWorkerMessage(worker: Worker, payload: unknown, onSuccess: (value: unknown | PromiseLike<unknown>) => void, onError: (reason?: unknown) => void) {
		const isFishedMessage = typeof payload === 'object' && payload !== null && (payload as { type?: unknown }).type === 'message'

		if(!isFishedMessage) return
		worker.removeListener('message', this.handleWorkerMessage)

		this.activeWorkers.delete(worker)
		this.workerCurrentTask.delete(worker)

		const taskCount = (this.workerTaskCount.get(worker) || 0) + 1
		this.workerTaskCount.set(worker, taskCount)

		if (await this.shouldRestartWorker(worker)) {
			await this.restartWorker(worker).catch(onError)
		}
		else {
			this.workerPool.push(worker)
		}
		this.notifyWorkerAvailable(worker)
		this.log('Task completed', worker.threadId)
		onSuccess(payload)
	}

	private async handleWorkerError(worker: Worker, err: Error, reject: (reason?: unknown) => void)  {
		const errorHandler = Reflect.getMetadata('worker:error', this)
		if (errorHandler && typeof this[errorHandler.handler as keyof this] === 'function') {
			const boundHandler = (this[errorHandler.handler as keyof this] as (...args: unknown[]) => void).bind(this)
			boundHandler(err)
		}
		this.log(`Worker encountered an error: ${err.message}`)
		this.activeWorkers.delete(worker)
		this.workerCurrentTask.delete(worker)


		await this.restartWorker(worker)
			.catch(reject)
		return reject(err)
	}

	handleWorkerExit(code: number) {
		const exitHandler = Reflect.getMetadata('worker:exit', this)
		if (exitHandler && typeof exitHandler.handler === 'function') {
			const boundHandler = (exitHandler.handler as (...args: unknown[]) => void).bind(this)
			boundHandler(code)
			console.log('boundHandler', boundHandler)
		}
	}
		
	/**
	 * Wait until a worker is available
	 * @private
	 * @returns {Promise<Worker>} Promise that resolves with a worker
	 * */
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
	 * Run a task on a worker, returning a promise that resolves a boolean indicating if the task was successfully queued
	 * @param data Data to pass to the worker, you can set the type of this parameter by setting the generic type of this function
	 * @returns {Promise<TResponse>} Promise that resolves with the result of the task
	 * */
	runTask<TParam>(data: TParam, transferList?: readonly TransferListItem[] | undefined): Promise<boolean> {
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
			worker.on('message',  async(payload: unknown) => this.handleWorkerMessage(worker, payload, resolve, reject))
			worker.once('error', (err: Error) => this.handleWorkerError(worker, err, reject))
			worker.postMessage(data, transferList)
			return resolve(true)
		})
	}

	/**
	 * Run a task on a worker, returning a promise that resolves with the result of the task
	 * * if you don't need the result of the task, use runTask instead
	 * * if you use await on this function, it will block the main thread until the task is completed
	 * @param data Data to pass to the worker, you can set the type of this parameter by setting the generic type of this function
	 * @returns {Promise<TResponse>} Promise that resolves with the result of the task
	 * */
	async runSyncTask<TParam, TResponse>(data: TParam, transferList?: readonly TransferListItem[] | undefined): Promise<TResponse> {
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

			worker.on('message',  async(payload: unknown) => this.handleWorkerMessage(worker, payload, resolve, reject))
			worker.once('error', (err: Error) => this.handleWorkerError(worker, err, reject))

			worker.postMessage(data, transferList)
			return worker
		})
	}



	/**
	 * Determine if a worker should be restarted, based on the number of tasks it has completed and how long it has been alive
	 * @param worker Worker to check
	 * @returns {boolean} True if the worker should be restarted
	 * */
	private async shouldRestartWorker(worker: Worker): Promise<boolean> {

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
			await this.waitUntilWorkerEmpty(worker)
			return false
		}

		return false
	}

	/**
	 * Wait for a worker to complete their current tasks, 
	 * * this should be called after delete the worker from the active workers set
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
		this.handleWorkerExit(0)
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

	/**
	 * Adjust the size of the worker pool
	 * @private
	 * */
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

	/**
	 * Destroy the worker pool
	 * @private
	 * */
	destroyWorkerPool() {
		this.workerPool.forEach(worker => {
			worker.terminate()
			worker.removeAllListeners()
		})
	}

	onModuleDestroy() {
		this.destroyWorkerPool()
	}
}