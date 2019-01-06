import crypto from 'crypto';
import path from 'path';
import _ from 'lodash';
import File from 'vinyl';
import through from 'through2';
import sinon from 'sinon';
import cache from '../src';

describe('gulp-cache', () => {

	let sandbox = null;
	let fakeFileHandler = null;
	let fakeTask = null;

	beforeEach((done) => {

		sandbox = sinon.sandbox.create();

		// Spy on the fakeFileHandler to check if it gets called later
		fakeFileHandler = sandbox.spy((file, enc, cb) => {

			file.ran = true;

			if (Buffer.isBuffer(file.contents)) {
				file.contents = new Buffer(`${String(file.contents)}-modified`);
			}

			cb(null, file);
		});

		fakeTask = through.obj(fakeFileHandler);

		cache.fileCache.clear('default', done);
	});

	afterEach(() => {
		sandbox.restore();
	});

	it('throws an error if no task is passed', () => {
		expect(() => cache()).toThrow();
	});

	it('exposes the Cache object for creating custom Caches', () => {
		expect(cache.Cache).toBeTruthy();
	});

	it('pass through the directories', (done) => {

		const directory = new File();
		const proxied = cache(fakeTask);

		proxied
			.on('data', (file) => {
				expect(file).toEqual(directory);
				expect(file.isNull()).toBe(true);
				done();
			})
			.end(new File());
	});

	describe('in streaming mode', () => {
		it('does not work', (done) => {
			// Create a proxied plugin stream
			const proxied = cache(fakeTask, {
				key(file, cb) {
					// For testing async key generation
					setTimeout(() => {
						cb(null, '123');
					}, 1);
				},
				value(file, cb) {
					// For testing async value generation
					setTimeout(() => {
						cb(null, {
							ran:    file.ran,
							cached: true
						});
					}, 1);
				}
			});

			proxied
				.on('error', (err) => {
					expect(err.message).toBe('Cannot operate on stream sources');
					done();
				})
				.end(new File({ contents: through() }));
		});
	});

	describe('in buffered mode', () => {
		it('only caches successful tasks', (done) => {
			// Create a proxied plugin stream
			const valStub = sandbox.stub().returns({
				ran:    true,
				cached: true
			});

			cache(fakeTask, {
				success() {
					return false;
				},
				value: valStub
			})
				.on('data', () => {
					expect(valStub.called).toBe(false);
					done();
				})
				.end(new File({
					contents: new Buffer('abufferwiththiscontent')
				}));
		});

		it('sets the content correctly on subsequently ran cached tasks', (done) => {
			// Create a proxied plugin stream
			const proxied = cache(fakeTask, {
				success() {
					return true;
				}
			});

			proxied.once('data', (file) => {
				expect(String(file.contents)).toBe('abufferwiththiscontent-modified');

				proxied.once('data', (file2) => {
					expect(file2.isBuffer()).toBe(true);
					expect(String(file2.contents)).toBe('abufferwiththiscontent-modified');

					done();
				});

				proxied.end(new File({
					contents: new Buffer('abufferwiththiscontent')
				}));
			});

			proxied.write(new File({
				contents: new Buffer('abufferwiththiscontent')
			}));
		});

		it('can proxy a task with specific options', (done) => {
			// create the fake file
			const fakeFile = new File({
				contents: new Buffer('abufferwiththiscontent')
			});
			const otherFile = new File({
				contents: new Buffer('abufferwiththiscontent')
			});
			const opts = {
				value(file) {
					return {
						ran:      file.ran,
						cached:   true,
						contents: file.contents || file._contents
					};
				}
			};
			// Create a proxied plugin stream
			let proxied = cache(fakeTask, opts);

			// write the fake file to it
			proxied.write(fakeFile);

			// wait for the file to come back out
			proxied.once('data', file => proxied._flush(() => {
				// make sure it came out the same way it went in
				expect(file.isBuffer()).toBe(true);

				// check the contents are same
				expect(String(file.contents)).toEqual('abufferwiththiscontent-modified');
				// Check it assigned the proxied task result
				expect(file.ran).toEqual(true);
				expect(file.cached).toBeFalsy();

				// Check the original task was called
				expect(fakeFileHandler.called).toEqual(true);

				// Reset for the second run through
				fakeFileHandler.reset();
				// Refresh proxied
				proxied = cache(fakeTask, opts);
				// Write the same file again, should be cached result
				proxied.write(otherFile);

				proxied.once('data', (secondFile) => {

					expect(secondFile.isBuffer()).toEqual(true);

					expect(String(secondFile.contents)).toEqual('abufferwiththiscontent-modified');

					// Cached value should have been applied
					expect(secondFile.ran).toEqual(true);
					expect(secondFile.cached).toEqual(true);

					// Should not have called the original task
					expect(fakeFileHandler.called).toEqual(false);

					done();
				});
			}));
		});

		it('can proxy a task using task.cacheable', (done) => {
			// Let the task define the cacheable aspects.
			fakeTask.cacheable = {
				key:     sandbox.spy(file => String(file.contents)),
				success: sandbox.stub().returns(true),
				value:   sandbox.spy(file => ({
					ran:      true,
					cached:   true,
					contents: file.contents || file._contents
				}))
			};

			let proxied = cache(fakeTask);

			// write the fake file to it
			proxied.write(new File({ contents: new Buffer('abufferwiththiscontent') }));

			// wait for the file to come back out
			proxied.once('data', file => proxied._flush(() => {
				// make sure it came out the same way it went in
				expect(file.isBuffer()).toEqual(true);

				// check the contents are same
				expect(String(file.contents)).toEqual('abufferwiththiscontent-modified');

				// Verify the cacheable options were used.
				expect(fakeTask.cacheable.key.called).toEqual(true);
				expect(fakeTask.cacheable.success.called).toEqual(true);
				expect(fakeTask.cacheable.value.called).toEqual(true);
				// Reset for the second run through
				_.invokeMap([
					fakeTask.cacheable.key,
					fakeTask.cacheable.success,
					fakeTask.cacheable.value,
					fakeFileHandler
				], 'reset');
				// Refresh proxied
				proxied = cache(fakeTask);
				// Write the same file again, should be cached result
				proxied.write(new File({ contents: new Buffer('abufferwiththiscontent') }));

				proxied.once('data', secondFile => proxied._flush(() => {
					expect(fakeTask.cacheable.key.called).toEqual(true);
					expect(fakeTask.cacheable.success.called).toEqual(false);
					expect(fakeTask.cacheable.value.called).toEqual(false);
					// Should not have called the original task
					expect(fakeFileHandler.called).toEqual(false);
					// Cached value should have been applied
					expect(secondFile.cached).toEqual(true);
					done();
				}));
			}));
		});

		it('can proxy a task using task.cacheable with user overrides', (done) => {
			// Let the task define the cacheable aspects.
			fakeTask.cacheable = {
				key:     sandbox.spy(file => String(file.contents)),
				success: sandbox.stub().returns(true),
				value:   sandbox.stub().returns({
					ran:    true,
					cached: true
				})
			};

			const overriddenValue = sandbox.stub().returns({
				ran:        true,
				cached:     true,
				overridden: true
			});
			const opts = { value: overriddenValue };
			// write the fake file to it
			let proxied = cache(fakeTask, opts);

			proxied.write(new File({
				contents: new Buffer('abufferwiththiscontent')
			}));

			// wait for the file to come back out
			proxied.once('data', file => proxied._flush(() => {
				// make sure it came out the same way it went in
				expect(file.isBuffer()).toEqual(true);

				// check the contents are same
				expect(String(file.contents)).toEqual('abufferwiththiscontent-modified');

				// Verify the cacheable options were used.
				expect(fakeTask.cacheable.key.called).toEqual(true);
				expect(fakeTask.cacheable.success.called).toEqual(true);
				expect(fakeTask.cacheable.value.called).toEqual(false);
				expect(overriddenValue.called).toEqual(true);

				_.invokeMap([
					fakeTask.cacheable.key,
					fakeTask.cacheable.success,
					fakeTask.cacheable.value,
					overriddenValue,
					fakeFileHandler
				], 'reset');

				// Refresh proxied
				proxied = cache(fakeTask, opts);
				// Write the same file again, should be cached result
				proxied.write(new File({
					contents: new Buffer('abufferwiththiscontent')
				}));

				proxied.once('data', secondFile => proxied._flush(() => {
					// Cached value should have been applied
					expect(secondFile.cached).toEqual(true);
					expect(secondFile.overridden).toEqual(true);

					expect(fakeTask.cacheable.key.called).toEqual(true);
					expect(fakeTask.cacheable.success.called).toEqual(false);
					expect(fakeTask.cacheable.value.called).toEqual(false);
					expect(overriddenValue.called).toEqual(false);

					// Should not have called the original task
					expect(fakeFileHandler.called).toEqual(false);

					done();
				}));
			}));
		});

		it('can be passed just a string for the value', (done) => {

			const opts = { value: 'ran' };
			// Create a proxied plugin stream
			let proxied = cache(fakeTask, opts);

			proxied.write(new File({
				contents: new Buffer('abufferwiththiscontent')
			}));

			proxied.once('data', file => proxied._flush(() => {
				// Check it assigned the proxied task result
				expect(file.ran).toEqual(true);

				// Refresh proxied
				proxied = cache(fakeTask, opts);

				// Write the same file again, should be cached result
				proxied.end(new File({
					contents: new Buffer('abufferwiththiscontent')
				}));

				proxied.once('data', secondFile => proxied._flush(() => {
					// Cached value should have been applied
					expect(secondFile.ran).toEqual(true);
					done();
				}));
			}));
		});

		it('can store changed contents of files', (done) => {
			const updatedFileHandler = sandbox.spy((file, enc, cb) => {
				file.contents = new Buffer('updatedcontent');
				cb(null, file);
			});

			fakeTask = through.obj(updatedFileHandler);

			// Create a proxied plugin stream
			let proxied = cache(fakeTask);

			// write the fake file to it
			proxied.write(new File({
				contents: new Buffer('abufferwiththiscontent')
			}));

			// wait for the file to come back out
			proxied.once('data', file => proxied._flush(() => {
				// Check for updated content
				expect(String(file.contents)).toEqual('updatedcontent');

				// Check original handler was called
				expect(updatedFileHandler.called).toEqual(true);

				updatedFileHandler.reset();

				// Refresh proxied
				proxied = cache(fakeTask);

				proxied.once('data', () => proxied._flush(() => {
					expect(String(file.contents)).toEqual('updatedcontent');

					// Check original handler was not called.
					expect(updatedFileHandler.called).toEqual(false);

					done();
				}));

				// Write the same file again, should be cached result
				proxied.write(new File({
					contents: new Buffer('abufferwiththiscontent')
				}));
			}));
		});

		it('can store one-to-many cache', (done) => {

			const updatedFileHandler = sandbox.spy(function each(file, enc, cb) {

				const outputFile1 = file.clone({ contents: false });
				const outputFile2 = file.clone({ contents: false });

				outputFile1.contents = new Buffer(`${String(file.contents)}-1`);
				outputFile2.contents = new Buffer(`${String(file.contents)}-2`);

				this.push(outputFile1);
				this.push(outputFile2);

				cb(null);
			});
			const pushedFilesCount = 2;
			const targetFile = new File({
				contents: new Buffer('abufferwiththiscontent')
			});

			fakeTask = through.obj(updatedFileHandler);

			const opts = {
				value:   sandbox.spy(cache.defaultOptions.value),
				restore: sandbox.spy(cache.defaultOptions.restore)
			};
			// Create a proxied plugin stream
			let proxied = cache(fakeTask, opts);
			let count = 0;

			cacheStep();

			function cacheStep() {

				proxied.on('data', (file) => {

					if (count == 0) {
						expect(String(file.contents)).toEqual('abufferwiththiscontent-1');
					} else {
						expect(String(file.contents)).toEqual('abufferwiththiscontent-2');
					}

					count++;
				});

				proxied.on('end', () => {
					expect(count).toEqual(pushedFilesCount);
					expect(opts.value.called).toEqual(true);
					expect(opts.restore.called).toEqual(false);
					fromCacheStep();
				});

				// write the fake file to it
				proxied.end(targetFile);
			}

			function fromCacheStep() {

				opts.value.reset();
				opts.restore.reset();

				proxied = cache(fakeTask, opts);
				count = 0;

				proxied.on('data', (file) => {

					if (count == 0) {
						expect(String(file.contents)).toEqual('abufferwiththiscontent-1');
					} else {
						expect(String(file.contents)).toEqual('abufferwiththiscontent-2');
					}

					count++;
				});

				proxied.on('end', () => {
					expect(count).toEqual(pushedFilesCount);
					expect(opts.value.called).toEqual(false);
					expect(opts.restore.called).toEqual(true);
					done();
				});

				// write the fake file to it
				proxied.end(targetFile);
			}
		});

		it('does not throw memory leak warning when proxying tasks', (done) => {

			const delay = 10;
			const filesCount = 30;

			fakeTask = through.obj((file, enc, cb) => {
				setTimeout(() => {
					file.contents = new Buffer(`${file.contents.toString()} updated`);

					cb(null, file);
				}, delay);
			});

			const proxied = cache(fakeTask);
			const origMaxListeners = fakeTask._maxListeners;
			const errSpy = sandbox.spy(console, 'error');
			let processedCount = 0;

			proxied
				.on('data', () => {
					processedCount += 1;
				})
				.on('end', () => {
					expect(processedCount).toEqual(filesCount);
					expect(errSpy.called).toEqual(false, 'Called console.error');
					expect(fakeTask._maxListeners).toEqual(origMaxListeners || 0);

					done();
				});

			_.times(filesCount, i => new File({
				contents: new Buffer(`Test File ${i}`)
			})).forEach((file) => {
				proxied.write(file);
			});

			proxied.end();
		});

		it('sets the cache based on file contents and path', (done) => {
			const filePath = path.join(process.cwd(), 'test', 'fixtures', 'in', 'file1.txt');
			const otherFilePath = path.join(process.cwd(), 'test', 'fixtures', 'in', 'file2.txt');
			const updatedFileHandler = sandbox.spy((file, enc, cb) => {
				file.contents = new Buffer('updatedcontent');

				cb(null, file);
			});

			fakeTask = through.obj(updatedFileHandler);

			// Create a proxied plugin stream
			let proxied = cache(fakeTask);

			// write the fake file to it
			proxied.write(new File({
				path:     filePath,
				contents: new Buffer('abufferwiththiscontent')
			}));

			// wait for the file to come back out
			proxied.once('data', file => proxied._flush(() => {
				// Check original handler was called
				expect(updatedFileHandler.called).toEqual(true);

				// Check the path is on there
				expect(file.path).toEqual(filePath);

				updatedFileHandler.reset();

				// Refresh proxied
				proxied = cache(fakeTask);

				// Write a file with same content but different path, should be cached result
				proxied.write(new File({
					path:     otherFilePath,
					contents: new Buffer('abufferwiththiscontent')
				}));

				proxied.once('data', secondFile => proxied._flush(() => {
					// Check for different file path
					expect(secondFile.path).toBeTruthy();
					expect(secondFile.path).toEqual(otherFilePath);

					// Check original handler was not called
					expect(updatedFileHandler.called).toEqual(false);

					done();
				}));
			}));
		});

		it('sets the cache based on file contents and path and keeps track of file path changes within the task', (done) => {
			const filePath = path.join(process.cwd(), 'test', 'fixtures', 'in', 'file1.txt');
			const otherFilePath = path.join(process.cwd(), 'test', 'fixtures', 'in', 'file2.txt');
			const outputFilePath = targetPath => targetPath.replace(/^(.*)\.txt$/i, '$1.txt2');
			const updatedFileHandler = sandbox.spy((file, enc, cb) => {
				file.contents = new Buffer('updatedcontent');
				// Change file path
				file.path = outputFilePath(file.path);
				cb(null, file);
			});

			fakeTask = through.obj(updatedFileHandler);

			// Create a proxied plugin stream
			let proxied = cache(fakeTask);

			// write the fake file to it
			proxied.write(new File({
				path:     filePath,
				contents: new Buffer('abufferwiththiscontent')
			}));

			// wait for the file to come back out
			proxied.once('data', file => proxied._flush(() => {
				// Check original handler was called
				expect(updatedFileHandler.called).toEqual(true);

				// Check it still has the changed output path
				expect(file.path).toEqual(outputFilePath(filePath));

				updatedFileHandler.reset();

				// Refresh proxied
				proxied = cache(fakeTask);

				// Write another file with the same contents and validate cache result
				proxied.write(new File({
					path:     otherFilePath,
					contents: new Buffer('abufferwiththiscontent')
				}));

				proxied.once('data', secondFile => proxied._flush(() => {
					// Check it still has the changed output path
					expect(secondFile.path).toEqual(outputFilePath(otherFilePath));

					// Check original handler was called
					expect(updatedFileHandler.called).toEqual(true);

					updatedFileHandler.reset();

					// Refresh proxied
					proxied = cache(fakeTask);

					// Write same file again and validate cache result
					proxied.write(new File({
						path:     otherFilePath,
						contents: new Buffer('abufferwiththiscontent')
					}));

					proxied.once('data', thirdFile => proxied._flush(() => {
						// Check it still has the changed output path
						expect(thirdFile.path).toEqual(outputFilePath(otherFilePath));

						// Check original handler was not called
						expect(updatedFileHandler.called).toEqual(false);

						done();
					}));
				}));
			}));
		});

		it('keeps track of file path changes within the task', (done) => {
			const filePath = path.join(process.cwd(), 'test', 'fixtures', 'in', 'file1.txt');
			const outputFilePath = filePath.replace(/^(.*)\.txt$/i, '$1.txt2');
			const updatedFileHandler = sandbox.spy((file, enc, cb) => {
				file.contents = new Buffer('updatedcontent');
				// Change file path
				file.path = outputFilePath;
				cb(null, file);
			});

			fakeTask = through.obj(updatedFileHandler);

			// Create a proxied plugin stream
			let proxied = cache(fakeTask);

			// write the fake file to it
			proxied.write(new File({
				path:     filePath,
				contents: new Buffer('abufferwiththiscontent')
			}));

			// wait for the file to come back out
			proxied.once('data', file => proxied._flush(() => {
				// Check original handler was called
				expect(updatedFileHandler.called).toBe(true);

				// Check it still has the changed output path
				expect(file.path).toBe(outputFilePath);

				updatedFileHandler.reset();

				// Refresh proxied
				proxied = cache(fakeTask);

				// Write same file again and validate cache result
				proxied.write(new File({
					path:     filePath,
					contents: new Buffer('abufferwiththiscontent')
				}));

				proxied.once('data', secondFile => proxied._flush(() => {
					// Check it still has the changed output path
					expect(secondFile.path).toBe(outputFilePath);

					// Check original handler was not called
					expect(updatedFileHandler.called).toBe(false);

					done();
				}));
			}));
		});
	});

	it('does nothing when it tries to clear a directory', (done) => {
		cache.clear()
			.on('data', (file) => {
				expect(file.isNull()).toBe(true);
				done();
			})
			.end(new File());
	});

	it('cannot clear specific stream cache', (done) => {
		cache.clear()
			.on('error', (err) => {
				expect(err.message).toBe('Cannot operate on stream sources');
				done();
			})
			.end(new File({ contents: through() }));
	});

	it('can clear specific buffer cache', (done) => {
		const fakeFileCache = {
			removeCached: sandbox.spy((category, hash, cb) => cb())
		};

		cache.clear({
			name:      'somename',
			fileCache: fakeFileCache,
			key() {
				return 'somekey';
			}
		})
			.on('data', () => {
				const someKeyHash = crypto.createHash('md5').update('somekey').digest('hex');

				expect(fakeFileCache.removeCached.calledWith('somename', someKeyHash)).toBe(true);
				done();
			})
			.end(new File({ contents: new Buffer('something') }));
	});

	it('can clear all the cache', () => {
		cache.clearAll();
	});

	it('can clear all the cache with Promise', () =>
		cache.clearAll()
	);
});
