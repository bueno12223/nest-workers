export interface WorkerOptions<T> {
    scriptPath: string;
    workerOptions?: WorkerThreadOptions<T>;
    maxWorkers?: number; 
    taskQueueLimit?: number;
    maxTasks?: number;
    maxLifetime?: number;
    verbose?: boolean;
    waitUntilAvailable?: boolean;
  }
  
  interface WorkerThreadOptions<T> {
    eval?: boolean;
    workerData?: T
    stdin?: boolean;
    stdout?: boolean;
    stderr?: boolean;
    execArgv?: string[];
    resourceLimits?: {
      maxYoungGenerationSizeMb?: number;
      maxOldGenerationSizeMb?: number;
      codeRangeSizeMb?: number;
      stackSizeMb?: number;
    };
  }
  