
/**
 * Decorator for listen a message from the worker, the function must be async
 * @param message Message to listen, by default is the name of the function
 */
export const onEmitted = (message?: string): MethodDecorator => {
	return (target: object, propertyKey: string | symbol) => {
		const metaDataTag = `worker:${message || propertyKey.toString()}`
		console.log('onEmitted', metaDataTag)
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
		console.log('onEmitted', metaDataTag)
		Reflect.defineMetadata(metaDataTag, { handler: propertyKey, once: true }, target)
	}
}

/**
 * Decorator for liten when any worker is restarted, the function must be async
 * @param message Message to listen, by default is the name of the function
 */
export const onRestart = (): MethodDecorator => {
	return (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) => {
		Reflect.defineMetadata('worker:restart', descriptor.value, {
			handler: descriptor.value,
		})
		return descriptor
	}
}

/**
 * Decorator for listen when a new worker is initialized, the function must be async
 * @param message Message to listen, by default is the name of the function
 */
export const onInit = (): MethodDecorator => {
	return (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) => {
		Reflect.defineMetadata('worker:init', descriptor.value, {
			handler: descriptor.value,
		})
		return descriptor
	}
}

/**
 * Decorator for listen when a worker is exited, the function must be async
 * @param message Message to listen, by default is the name of the function
 */
export const onExit = (): MethodDecorator => {
	return (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) => {
		Reflect.defineMetadata('worker:exit', descriptor.value, {
			handler: descriptor.value,
		})
		return descriptor
	}
}