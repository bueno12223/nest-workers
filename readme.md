# @Nest/workers-pool

"NestJS Workers Pool" is a robust library for NestJS that enables you to execute functions in separate processes using [worker_threads](https://nodejs.org/api/worker_threads.html). This prevents the main thread from being blocked in heavy computation process and also allows you to control the number of functions running concurrently.

- It manages a pool of workers, automatically assigning tasks and queuing them when all workers are busy.

- `runAsyncTask` for awaiting task results, and `runTask` for non-blocking execution, you have the flexibility to choose based on your needs.

- When using the `waitUntilAvailable` option, tasks wait in the queue until a worker is free, preventing overloading.

- Workers are restarted after reaching their maximum tasks or lifetime, maintaining optimal performance.

- Extend or inject `WorkerPoolService` as needed, and use decorators for handling custom events in worker scripts.

- Use of decorador as `@OnMessage` or `@onError` to handle custom events in your service.


## Installation

```bash
npm install nestjs-workers-pool
```

## Usage as a extendable service

```typescript
import { Injectable } from '@nestjs/common';
import { WorkerPoolService, onEmitted, onceEmitted, onError } from '@nestjs/workers-pool';

@Injectable()
export class FibonacciService extends WorkerPoolService {
  constructor() {
    super({
      scriptPath: './src/workers/heavy_task_worker.js',
      waitUntilAvailable: true,
      workerOptions: {
        execArgv: ['--max-old-space-size=4096'],
      },
    });
  }

  async calcFibonacci(n: number): Promise<boolean> {
    return this.runTask(n);
  }

  // by default the name of the method
  @onEmitted()
  progress(data: { progress: number }): void {
    console.log(`Progress: ${data.progress}`);
  }

  @onEmitted('message')
  message(data: { result: string }): void {
    console.log(`Message: ${data.result}`);
  }

  @onError()
    error(data: { error: string }): void {
        console.log(`Error: ${data.error}`);
    }
}
```

## Usage as a inyectable service

```typescript
// module.ts
import { Module } from '@nestjs/common';
import { WorkerPoolService, WORKER_OPTIONS_TOKEN } from '@nestjs/workers-pool';

@Module({
  providers: [
    {
      provide: WORKER_OPTIONS_TOKEN,
      useValue: {
        scriptPath: './src/workers/heavy_task_worker.js',
        waitUntilAvailable: true,
        maxWorkers: 2,
        maxLifetime: 10000,
        maxTasks: 10,
      },
    },
    WorkerPoolService,
  ],
})
export class AppModule {}
```

```typescript
// app.service.ts
import { Injectable } from '@nestjs/common';

import { WorkersPool } from '@nest/workers-pool';

@Injectable()
export class AppService {
  constructor(private readonly workersPool: WorkersPool) {}

  async run() {
    // run task in a separate process, returns a boolean if the task was queued
    this.workersPool.runTask()

    // run task in a separate process, returns a result of the task
    const result = this.workersPool.runSyncTask()
    console.log(result)
  }
}
```


### Worker script

```javascript
// heavy_task_worker.js
const { parentPort } = require('worker_threads');

parentPort.on('message', (data) => {
  parentPort.postMessage({ progress: 0.1, type: 'progress' });
  // do something
  parentPort.postMessage({ progress: 1, type: 'progress' });
  parentPort.postMessage({ result: 'done', type: 'message' });
});
```
- To trigger the custom events you should use the `type` property in the message object with the name of the event.
- If you send an unhandled event, it will be ignored.
- You should always send a `type: 'message'` in the final result, or the worker will never be flag as available again and the task will be queued forever, once you send the `type: 'message'` it will be stop listening for events and the worker will continue with the lifecycle.

## Configuration

| Option            | Type     | Default value | Description                                                                 |
| ----------------- | -------- | ------------- | --------------------------------------------------------------------------- |
| scriptPath        | string   |               | Path to the worker script                                                   |
| maxWorkers        | number   | os.cpus().length | The maximum number of workers that can be started simultaneously |
| waitUntilAvailable | boolean  | false         | Wait until the worker is ready to accept tasks, if is false, it will throw an error |     
| workerOptions     | object   | {}            | Options for the worker thread                                               |
| maxTasks          | number   | 0             | The maximum number of tasks that can be run                                 |
| maxLifetime       | number   | 0             | The maximum lifetime of a worker in milliseconds                            |
| verbose           | boolean  | false         | Show debug information                                                      |

## handling custom events

There are several decorators available for handling different types of events:

- Use the `@onEmitted()` decorator to handle custom events. This will be executed each time the specified event is emitted.

- The `@onceEmitted()` decorator is also for handling custom events, but it will only be executed the first time the event is emitted.

- To handle errors, use the `@onError()` decorator. This will be executed each time an error raised in the worker.

- The `@onExit()` decorator is for handling the exit event. This will be executed each time the exit event is emitted.

- You can destroy all workers with the `destroyWorkerPool()` method if you need to, bt any pending task will be lost.


```typescript
import { Injectable } from '@nestjs/common';
import { WorkerPoolService, onEmitted, onceEmitted, onError } from '@nestjs/workers-pool';

@Injectable()
export class FibonacciService extends WorkerPoolService {
  constructor() {
    super({
      scriptPath: './src/workers/heavy_task_worker.js',
      waitUntilAvailable: true,
      maxWorkers: 2,
    });
  }

  async calcFibonacci(n: number): Promise<boolean> {
    // you can send a transferable object to the worker
    const transferList = [n];
    return this.runTask(n, transferList);
  }

  // by default the name of the method
  @onEmitted()
  progress(data: { progress: number }): void {
    console.log(`Progress: ${data.progress}`);
  }

  @onEmitted('message')
  message(data: { result: string }): void {
    console.log(`Message: ${data.result}`);
  }

  @onError()
    error(data: { error: string }): void {
        console.log(`Error: ${data.error}`);
    }

  @onExit()
    exit(data: { exitCode: number }): void {
        console.log(`Exit: ${data.exitCode}`);
    }

}
```


```javascript
// heavy_task_worker.js
const { parentPort } = require('worker_threads');

parentPort.on('message', (data) => {
  parentPort.postMessage({ progress: 0.1, type: 'progress' });
  // do something
  parentPort.postMessage({ progress: 1, type: 'progress' });
  parentPort.postMessage({ result: 'done', type: 'message' });
});
```


## Future improvements

- Integrations with services like Bull or RabbitMQ
- Send intransferible objects to the worker like streams or sockets
- Integrations with TypeORM to handle database connections


This is my first library so any feedback is welcome, I will be happy to receive your comments and pull requests! :D
@bueno12223