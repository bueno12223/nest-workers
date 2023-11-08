import { Test, TestingModule } from '@nestjs/testing'
import { WorkerPoolService } from '../index'
import { WORKER_OPTIONS_TOKEN } from '../constants'

describe('WorkerPoolService', () => {
	let service: WorkerPoolService

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				WorkerPoolService,
				{
					provide: WORKER_OPTIONS_TOKEN,
					useValue: {
						scriptPath: 'path/to/worker',
						workerOptions: {},
						maxWorkers: 2,
						maxTasks: 2,
						maxLifetime: 1000,
					},
				},
			],
		}).compile()

		service = module.get<WorkerPoolService>(WorkerPoolService)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	const mockWorker = {
		on: jest.fn(),
		once: jest.fn(),
		postMessage: jest.fn(),
		removeAllListeners: jest.fn(),
		terminate: jest.fn(() => Promise.resolve()),
	}

	jest.mock('worker_threads', () => ({
		Worker: jest.fn(() => mockWorker),
	}))

	it('should create a worker pool on initialization', () => {
		expect(service['workerPool'].length).toBe(2)
	})

	it('should run a task on a worker', async () => {
		const task = { some: 'task' }
		await service.runTask(task)
		// Make assertions on the task running mechanism, like checking if postMessage was called
		expect(mockWorker.postMessage).toHaveBeenCalledWith(task)
	})

	afterEach(async () => {
		jest.clearAllMocks()
	})

	afterAll(async () => {
		service.onModuleDestroy()
	})
})
