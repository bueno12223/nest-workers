import { Test, TestingModule } from '@nestjs/testing'
import { WorkerPoolService } from '../index'
import { WORKER_OPTIONS_TOKEN } from '../constants'
import { WorkerOptions } from 'types'

describe('WorkerPoolService', () => {
	let service: WorkerPoolService
	const mockWorker = {
		on: jest.fn(),
		once: jest.fn(),
		postMessage: jest.fn(),
		removeAllListeners: jest.fn(),
		terminate: jest.fn(() => Promise.resolve()),
		off: jest.fn(),
		ref: jest.fn(),
		unref: jest.fn(),
	}

	const workerOptions: WorkerOptions<unknown> = {
		scriptPath: './__tests__/woker.js',
		workerOptions: {},
		maxWorkers: 2,
		maxTasks: 100,
		maxLifetime: 10000,
		verbose: true,
	}

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				WorkerPoolService,
				{
					provide: WORKER_OPTIONS_TOKEN,
					useValue: workerOptions,
				},
			],
		})
			.compile()

		service = module.get<WorkerPoolService>(WorkerPoolService)
	})

	beforeEach(() => {
		jest.mock('worker_threads', () => ({
			Worker: jest.fn(() => mockWorker),
		}))
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	it('should create a worker pool on initialization', () => {
		expect(service['workerPool'].length).toBe(2)
	})

	let spies: jest.SpyInstance[] = []

	beforeEach(() => {
		spies = service['workerPool'].map(worker => jest.spyOn(worker, 'postMessage'))
	})

	describe('runSyncTask', () => {

		it('should run a task on a worker', async () => {
			const task = 1
			await service.runSyncTask(1)
			const lasWorker = spies[spies.length - 1].mock.calls
			expect(lasWorker[0][0]).toBe(task)
		})

		it('should throw an error if no worker is available', async () => {
			const task = { some: 'task' }
			await service.runTask(task)
			await service.runTask(task)
			await service.runTask(task).catch(err => {
				expect(err.message).toBe('No workers available')
			})

		})

		beforeEach(() => {
			workerOptions.waitUntilAvailable = true
		})

		it('should push a task in pendingTasksResolvers when not workers available', async () => {
			const tasks = Array.from({ length: 3 }, (_, i) => ({ some: `task ${i}` }))
			const promises = tasks.map(task => service.runTask(task))
			await Promise.all(promises)
			expect(service['pendingTasksResolvers']).toHaveLength(1)
		})

		it('should run a task when a worker is available', async () => {
			console.log(service['workerPool'].length, service['activeWorkers'].size)
			const mockResolve = jest.fn()
			service['pendingTasksResolvers'].push(mockResolve)

			const task = { some: 'task' }
			await service.runSyncTask(task)
			expect(service['pendingTasksResolvers']).toHaveLength(0)
			expect(mockResolve).toHaveBeenCalled()
		}, 30000)

	})

	describe('worker lifecycle', () => { 
		beforeEach(() => {
			workerOptions.maxLifetime = 100
		})

		it('should remove a worker from the pool when it exits',async () => {
			const workerToRemove = service['workerPool'][0]
			const threadId = workerToRemove.threadId
			workerToRemove.emit('exit')
			await new Promise(resolve => setTimeout(resolve, 2000))
			expect(service['workerPool'].map(worker => worker.threadId)).not.toContain(threadId)
		})


		it('should replenish the worker pool when a worker is deleted', async () => {
			const workerToRemove = service['workerPool'][0]
			workerToRemove.emit('exit')
			await new Promise(resolve => setTimeout(resolve, 2000))
			expect(service['workerPool']).toHaveLength(2)
		})

		it('should restart a worker when it completes the max lifetime', async () => {
			const workerToRemove = service['workerPool'][service['workerPool'].length - 1]
			service['workerCreationTimes'].set(workerToRemove, Date.now() - 100000)
			const threadId = workerToRemove.threadId
			await service.runSyncTask(1)
			await new Promise(resolve => setTimeout(resolve, 2000))
			expect(service['workerPool'].map(worker => worker.threadId)).not.toContain(threadId)
		})

		it('should restart a worker when it completes the max tasks', async () => {
			const workerToRemove = service['workerPool'][service['workerPool'].length - 1]
			const threadId = workerToRemove.threadId
			service['workerTaskCount'].set(workerToRemove, 100)
			await service.runSyncTask(1)
			await new Promise(resolve => setTimeout(resolve, 2000))
			expect(service['workerPool'].map(worker => worker.threadId)).not.toContain(threadId)
		})


		it('should not restart a worker until completes his pending task', async () => {
			const pendingWorkerPromise = jest.fn()
			
			const workerToRemove = service['workerPool'][service['workerPool'].length - 1]
			const threadId = workerToRemove.threadId
			service['workerTaskCount'].set(workerToRemove, 100)
			service['workerCurrentTask'].set(workerToRemove, pendingWorkerPromise)
			await service.runSyncTask(1)
			await new Promise<void>(resolve => setTimeout(() => {
				service['workerCurrentTask'].delete(workerToRemove)
				resolve()
			}
			, 2000))
			expect(service['workerPool'].map(worker => worker.threadId)).not.toContain(threadId)
		})

	 })

	afterEach(async () => {
		service.onModuleDestroy()
		jest.clearAllMocks()

	})
})
