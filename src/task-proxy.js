import EventEmitter from 'events';
import crypto from 'crypto';
import File from 'vinyl';
import pick from 'object.pick';

const whitespaces = 2;
const eventListenersCount = 3;

function makeHash(key) {
	return crypto.createHash('md5').update(key).digest('hex');
}

export default class TaskProxy {

	constructor(task, inputOptions) {

		this.task = task;
		this.options = inputOptions;
		this._cacheQueue = new Map();
		this._removeListeners = [];

		if (task) {
			this.patchTask();
		}
	}

	patchTask() {

		const { task } = this;
		const { _transform } = task;

		task._transform = (chunk, encoding, next) => {

			Reflect.apply(_transform, task, [chunk, encoding, (...args) => {
				next(...args); // eslint-disable-line
				task.emit('gulp-cache:transformed');
			}]);
		};
	}

	processFile(inputFile, signals = new EventEmitter()) {

		process.nextTick(() => {
			this._processFileAsync(inputFile, signals);
		});

		return signals;
	}

	async _processFileAsync(inputFile, signals = new EventEmitter()) {

		const cached = await this._checkForCachedValue(inputFile);
		// If we found a cached value
		// The path of the cache key should also be identical to the original one when the file path changed inside the task
		const cachedValue = cached.value;
		const cachedValueIsEmpty = !Array.isArray(cachedValue) || !cachedValue.length;
		const cachedValuesWithNormalPaths = cachedValueIsEmpty ? [] : cachedValue.filter(
			file =>
				(!file.gulpCache$filePathChangedInsideTask || file.gulpCache$originalPath === inputFile.path)
				&& (!file.gulpCache$fileBaseChangedInsideTask || file.gulpCache$originalBase === inputFile.base)
		);

		if (cachedValuesWithNormalPaths.length) {

			cachedValuesWithNormalPaths.forEach((cachedFile) => {
				// Extend the cached value onto the file, but don't overwrite original path info
				const file = new File({
					// custom properties
					...cachedFile,
					// file info
					...pick(inputFile, ['cwd', 'base', 'stat', 'history', 'path']),
					// file contents
					contents: cachedFile.contents
				});

				// Restore the file path if it was set
				if (cachedFile.path && cachedFile.gulpCache$filePathChangedInsideTask) {
					file.path = cachedFile.path;
				}

				// Restore the file base if it was set
				if (cachedFile.base && cachedFile.gulpCache$fileBaseChangedInsideTask) {
					file.base = cachedFile.base;
				}

				Reflect.deleteProperty(file, 'gulpCache$filePathChangedInsideTask');
				Reflect.deleteProperty(file, 'gulpCache$fileBaseChangedInsideTask');
				Reflect.deleteProperty(file, 'gulpCache$originalPath');
				Reflect.deleteProperty(file, 'gulpCache$originalBase');

				signals.emit('file', file);
			});

			signals.emit('done');

			this._removeListeners.push(() => {
				// Remove all listeners from `signals`
				signals.removeAllListeners();
			});

			return;
		}

		this._runProxiedTaskAndQueueCache(inputFile, cached.key, signals);
	}

	async flush(next) {

		const { task } = this;

		try {

			if (typeof task._flush == 'function') {
				task._flush(async (...args) => {
					await this._flush();
					next(...args);
				});
			} else {
				await this._flush();
				next();
				return;
			}

		} catch (err) {
			next(err);
			return;
		}
	}

	async _flush() {

		this._removeListeners.forEach((remove) => {
			remove();
		});

		this._removeListeners = [];

		await Promise.all(
			Array.from(this._cacheQueue).map(
				async ([cachedKey, files]) =>
					this._storeCachedResult(cachedKey, files)
			)
		);

		this._cacheQueue = new Map();
	}

	async removeCachedResult(file) {

		const cachedKey = await this._getFileKey(file);

		return this._removeCached(
			this.options.name,
			cachedKey
		);
	}

	async _getFileKey(file) {

		const { key: getKey } = this.options;
		const key = await getKey(file);

		return key ? makeHash(key) : key;
	}

	async _checkForCachedValue(file) {

		const key = await this._getFileKey(file);

		// If no key returned, bug out early
		if (!key) {
			return {
				value: null,
				key
			};
		}

		const { name: cacheName, restore } = this.options;
		const cached = await this._getCached(cacheName, key);

		if (!cached) {
			return {
				value: null,
				key
			};
		}

		let parsedContents = null;

		try {
			parsedContents = JSON.parse(cached.contents);
		} catch (err) {
			parsedContents = [{ cached: cached.contents }];
		}

		if (restore) {
			parsedContents = parsedContents.map(
				(parsedFile) => {

					const restoredFile = restore(parsedFile);

					// Force restore service properties
					restoredFile.gulpCache$filePathChangedInsideTask = parsedFile.gulpCache$filePathChangedInsideTask;
					restoredFile.gulpCache$fileBaseChangedInsideTask = parsedFile.gulpCache$fileBaseChangedInsideTask;
					restoredFile.gulpCache$originalPath = parsedFile.gulpCache$originalPath;
					restoredFile.gulpCache$originalBase = parsedFile.gulpCache$originalBase;

					return restoredFile;
				}
			);
		}

		return {
			value: parsedContents,
			key
		};
	}

	async _getValueFromResult(result) {

		const { value: getValue } = this.options;

		if (typeof getValue !== 'function') {

			if (typeof getValue === 'string') {
				return {
					[getValue]: result[getValue]
				};
			}

			return getValue;
		}

		return getValue(result);
	}

	async _storeCachedResult(key, result) {

		// If we didn't have a cachedKey, skip caching result
		if (!key) {
			return result;
		}

		const { options } = this;
		const files = (await Promise.all(result.map(
			async ({ file, meta }) => {

				if (options.success !== true && !(await options.success(file))) {
					return null;
				}

				return Object.assign(
					await this._getValueFromResult(file),
					meta
				);
			}
		))).filter(Boolean);

		return this._addCached(
			this.options.name,
			key,
			JSON.stringify(files, null, whitespaces)
		);
	}

	async _queueCache(file, cachedKey, originalBase, originalPath) {

		const { _cacheQueue } = this;
		const item = {
			file: file.clone({ contents: false }),
			meta: {
				// Check if the task changed the file path
				gulpCache$filePathChangedInsideTask: file.path !== originalPath,
				// Check if the task changed the base path
				gulpCache$fileBaseChangedInsideTask: file.base !== originalBase,
				// Keep track of the original path
				gulpCache$originalPath:              originalPath,
				// Keep track of the original base
				gulpCache$originalBase:              originalBase
			}
		};

		if (_cacheQueue.has(cachedKey)) {
			_cacheQueue.get(cachedKey).push(item);
		} else {
			_cacheQueue.set(cachedKey, [item]);
		}
	}

	_runProxiedTaskAndQueueCache(file, cachedKey, signals = new EventEmitter()) {

		const originalBase = file.base;
		const originalPath = file.path;

		signals.on('cache', (file) => {
			this._queueCache(file, cachedKey, originalBase, originalPath);
			signals.emit('file', file);
		});

		return this._runProxiedTask(file, cachedKey, signals);
	}

	_runProxiedTask(file, cachedKey, signals = new EventEmitter()) {

		const { task } = this;
		const hasCacheListener = Boolean(signals.listenerCount('cache'));

		function onError(err) {
			signals.emit('error', err);
		}

		function onData(datum) {

			if (datum._cachedKey !== cachedKey) {
				return;
			}

			Reflect.deleteProperty(datum, '_cachedKey');

			if (hasCacheListener) {
				signals.emit('cache', datum);
			} else {
				signals.emit('file', datum);
			}
		}

		function onTransformed() {
			signals.emit('done');
		}

		this._removeListeners.push(() => {
			// Be good citizens and remove our listeners
			task.removeListener('error', onError);
			task.removeListener('gulp-cache:transformed', onTransformed);
			task.removeListener('data', onData);

			// Reduce the maxListeners back down
			task.setMaxListeners(task._maxListeners - eventListenersCount);

			// Remove all listeners from `signals`
			signals.removeAllListeners();
		});

		// Bump up max listeners to prevent memory leak warnings
		const currMaxListeners = task._maxListeners || 0;

		task.setMaxListeners(currMaxListeners + eventListenersCount);

		task.on('data', onData);
		task.once('gulp-cache:transformed', onTransformed);
		task.once('error', onError);

		file._cachedKey = cachedKey;

		// Run through the other task and grab output (or error)
		task.write(file);

		return signals;
	}

	/**
	 * Cache promise wrappers.
	 */

	_addCached(...args) {
		return new Promise((resolve, reject) => {
			this.options.fileCache.addCached(...args, (err, res) => {

				if (err) {
					reject(err);
					return;
				}

				resolve(res);
			});
		});
	}

	_getCached(...args) {
		return new Promise((resolve, reject) => {
			this.options.fileCache.getCached(...args, (err, res) => {

				if (err) {
					reject(err);
					return;
				}

				resolve(res);
			});
		});
	}

	_removeCached(...args) {
		return new Promise((resolve, reject) => {
			this.options.fileCache.removeCached(...args, (err) => {

				if (err) {
					reject(err);
					return;
				}

				resolve();
			});
		});
	}
}
