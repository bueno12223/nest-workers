const { parentPort } = require('worker_threads')

parentPort.on('message', (number) => {
	parentPort.postMessage({
		result: number * 2,
		type: 'message'
	})
})
