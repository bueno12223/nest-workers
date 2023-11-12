import 'reflect-metadata'
import { onEmitted, onceEmitted, onExit, onError } from '../decorators'

describe('Decorators', () => {
	class TestClass {
        @onEmitted('testMessage')
		async testMethod() {
			// Método de prueba
		}

        @onceEmitted('testMessageOnce')
        async testMethodOnce() {
        	// Método de prueba
        }

        @onExit()
        async testMethodExit() {
        	// Método de prueba
        }

        @onError()
        async testMethodError() {
        	// Método de prueba
        }
	}

	it('should add metadata to the methods', () => {
		const testInstance = new TestClass()

		const onEmittedMetadata = Reflect.getMetadata('worker:testMessage', testInstance)
		expect(onEmittedMetadata).toEqual({ handler: 'testMethod', once: false })

		const onceEmittedMetadata = Reflect.getMetadata('worker:testMessageOnce', testInstance)
		expect(onceEmittedMetadata).toEqual({ handler: 'testMethodOnce', once: true })

		const onExitMetadata = Reflect.getMetadata('worker:exit', testInstance)
		expect(onExitMetadata).toEqual({ handler: testInstance.testMethodExit, once: false })

		const onErrorMetadata = Reflect.getMetadata('worker:error', testInstance)
		expect(onErrorMetadata).toEqual({ handler: testInstance.testMethodError, once: false })
	})
})