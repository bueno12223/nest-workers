# @Nest/workers-pool

"NodeJS Workers Pool" is a robust library for NodeJS that enables you to execute functions in separate processes. This prevents the main thread from being blocked and also allows you to control the number of functions running concurrently.

The library automatically creates a pool of workers and assigns tasks to the next available worker. If all workers are busy, tasks are queued until a worker becomes available again.

Furthermore, "NodeJS Workers Pool" manages the lifecycle of the workers, restarting them when they reach their maximum lifetime or the maximum number of tasks per worker. This ensures optimal performance and efficient resource management.

 You can use the `WorkerPoolService` as a extendable service, or as a inyectable service, and handle custom events in decorators.

## Installation

```bash
npm install @nest/workers-pool
```

## Usage as a extendable service

```typescript
import { Injectable } from '@nestjs/common';
import { WorkerPoolService, onEmitted, onceEmitted } from '@nestjs/workers-pool';

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

  @onceEmitted('error')
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


## Worker script

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
- You should always send a `type: 'message'` in the final result, or the worker will never be flag as available again and the task will be queued forever, once you send the `type: 'message'` it will be stop listening for events.

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


## Future improvements

- Better handling of errors
- Integrations with services like Bull or RabbitMQ
- Send intransferible objects to the worker like streams or sockets
- Integrations with TypeORM to handle database connections