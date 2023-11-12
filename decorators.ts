
/**
 * Decorator for listen a message from the worker, the function must be async
 * @param message Message to listen, by default is the name of the function
 */
export const onEmitted = (message?: string): MethodDecorator => {
	return (target: object, propertyKey: string | symbol) => {
		const metaDataTag = `worker:${message || propertyKey.toString()}`
		Reflect.defineMetadata(metaDataTag, { handler: propertyKey, once: false }, target)
	}
}

/**
 * Decorator for listen a message from the worker, the function must be async
 * @param message Message to listen, by default is the name of the function
 */

export const onceEmitted = (message?: string): MethodDecorator => {
	return (target: object, propertyKey: string | symbol) => {
		const metaDataTag = `worker:${message || propertyKey.toString()}`
		Reflect.defineMetadata(metaDataTag, { handler: propertyKey, once: true }, target)
	}
}

/**
 * Decorator for listen when a worker is exited, the function must be async
 * @param message Message to listen, by default is the name of the function
 */
export const onExit = (): MethodDecorator => {
	return (target: object, _propertyKey: string, descriptor: PropertyDescriptor) => {
		Reflect.defineMetadata('worker:exit', { handler: descriptor.value, once: false }, target)
	}
}

/**
 * Decorator for listen when a worker is exited, the function must be async
 * @param message Message to listen, by default is the name of the function
 */
export const onError = (): MethodDecorator => {
	return (target: object, _propertyKey: string, descriptor: PropertyDescriptor) => {
		Reflect.defineMetadata('worker:error', { handler: descriptor.value, once: false }, target)
	}
}
