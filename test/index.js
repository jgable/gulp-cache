import crypto from 'crypto';
import path from 'path';
import _ from 'lodash';
import File from 'vinyl';
import should from 'should';
import through from 'through2';
import sinon from 'sinon';
import cache from '../src';

describe('gulp-cache', () => {

	let sandbox = null,
		fakeFileHandler = null,
		fakeTask = null;

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
		cache.should.throw();
	});

	it('exposes the Cache object for creating custom Caches', () => {
		should.exist(cache.Cache);
	});

	it('pass through the directories', (done) => {

		const directory = new File(),
			proxied = cache(fakeTask);

		proxied
			.on('data', (file) => {
				file.should.eql(directory);
				file.isNull().should.equal(true);
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
					err.message.should.equal('Cannot operate on stream sources');
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
					valStub.called.should.equal(false);
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
				String(file.contents).should.equal('abufferwiththiscontent-modified');

				proxied.once('data', (file2) => {
					should.exist(file2.isBuffer());
					String(file2.contents).should.equal('abufferwiththiscontent-modified');

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
				file.isBuffer().should.equal(true);

				// check the contents are same
				String(file.contents).should.equal('abufferwiththiscontent-modified');
				// Check it assigned the proxied task result
				file.ran.should.equal(true);
				should.not.exist(file.cached);

				// Check the original task was called
				fakeFileHandler.called.should.equal(true);

				// Reset for the second run through
				fakeFileHandler.reset();
				// Refresh proxied
				proxied = cache(fakeTask, opts);
				// Write the same file again, should be cached result
				proxied.write(otherFile);

				proxied.once('data', (secondFile) => {

					secondFile.isBuffer().should.equal(true);

					String(secondFile.contents).should.equal('abufferwiththiscontent-modified');

					// Cached value should have been applied
					secondFile.ran.should.equal(true);
					secondFile.cached.should.equal(true);

					// Should not have called the original task
					fakeFileHandler.called.should.equal(false);

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
				file.isBuffer().should.equal(true);

				// check the contents are same
				String(file.contents).should.equal('abufferwiththiscontent-modified');

				// Verify the cacheable options were used.
				fakeTask.cacheable.key.called.should.equal(true);
				fakeTask.cacheable.success.called.should.equal(true);
				fakeTask.cacheable.value.called.should.equal(true);
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
					fakeTask.cacheable.key.called.should.equal(true);
					fakeTask.cacheable.success.called.should.equal(false);
					fakeTask.cacheable.value.called.should.equal(false);
					// Should not have called the original task
					fakeFileHandler.called.should.equal(false);
					// Cached value should have been applied
					secondFile.cached.should.equal(true);
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
				file.isBuffer().should.equal(true);

				// check the contents are same
				String(file.contents).should.equal('abufferwiththiscontent-modified');

				// Verify the cacheable options were used.
				fakeTask.cacheable.key.called.should.equal(true);
				fakeTask.cacheable.success.called.should.equal(true);
				fakeTask.cacheable.value.called.should.equal(false);
				overriddenValue.called.should.equal(true);

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
					secondFile.cached.should.equal(true);
					secondFile.overridden.should.equal(true);

					fakeTask.cacheable.key.called.should.equal(true);
					fakeTask.cacheable.success.called.should.equal(false);
					fakeTask.cacheable.value.called.should.equal(false);
					overriddenValue.called.should.equal(false);

					// Should not have called the original task
					fakeFileHandler.called.should.equal(false);

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
				file.ran.should.equal(true);

				// Refresh proxied
				proxied = cache(fakeTask, opts);

				// Write the same file again, should be cached result
				proxied.end(new File({
					contents: new Buffer('abufferwiththiscontent')
				}));

				proxied.once('data', secondFile => proxied._flush(() => {
					// Cached value should have been applied
					secondFile.ran.should.equal(true);
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
				String(file.contents).should.equal('updatedcontent');

				// Check original handler was called
				updatedFileHandler.called.should.equal(true);

				updatedFileHandler.reset();

				// Refresh proxied
				proxied = cache(fakeTask);

				proxied.once('data', () => proxied._flush(() => {
					String(file.contents).should.equal('updatedcontent');

					// Check original handler was not called.
					updatedFileHandler.called.should.equal(false);

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

				const outputFile1 = file.clone({ contents: false }),
					outputFile2 = file.clone({ contents: false });

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
			let proxied = cache(fakeTask, opts),
				count = 0;

			cacheStep();

			function cacheStep() {

				proxied.on('data', (file) => {

					if (count == 0) {
						String(file.contents).should.equal('abufferwiththiscontent-1');
					} else {
						String(file.contents).should.equal('abufferwiththiscontent-2');
					}

					count++;
				});

				proxied.on('end', () => {
					count.should.equal(pushedFilesCount);
					opts.value.called.should.equal(true);
					opts.restore.called.should.equal(false);
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
						String(file.contents).should.equal('abufferwiththiscontent-1');
					} else {
						String(file.contents).should.equal('abufferwiththiscontent-2');
					}

					count++;
				});

				proxied.on('end', () => {
					count.should.equal(pushedFilesCount);
					opts.value.called.should.equal(false);
					opts.restore.called.should.equal(true);
					done();
				});

				// write the fake file to it
				proxied.end(targetFile);
			}
		});

		it('does not throw memory leak warning when proxying tasks', (done) => {

			const delay = 10,
				filesCount = 30;

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
					processedCount.should.equal(filesCount);
					errSpy.called.should.equal(false, 'Called console.error');
					fakeTask._maxListeners.should.equal(origMaxListeners || 0);

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
				updatedFileHandler.called.should.equal(true);

				// Check the path is on there
				file.path.should.equal(filePath);

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
					should.exist(secondFile.path);
					secondFile.path.should.equal(otherFilePath);

					// Check original handler was not called
					updatedFileHandler.called.should.equal(false);

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
				updatedFileHandler.called.should.equal(true);

				// Check it still has the changed output path
				file.path.should.equal(outputFilePath(filePath));

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
					secondFile.path.should.equal(outputFilePath(otherFilePath));

					// Check original handler was called
					updatedFileHandler.called.should.equal(true);

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
						thirdFile.path.should.equal(outputFilePath(otherFilePath));

						// Check original handler was not called
						updatedFileHandler.called.should.equal(false);

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
				updatedFileHandler.called.should.equal(true);

				// Check it still has the changed output path
				file.path.should.equal(outputFilePath);

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
					secondFile.path.should.equal(outputFilePath);

					// Check original handler was not called
					updatedFileHandler.called.should.equal(false);

					done();
				}));
			}));
		});
	});

	it('does nothing when it tries to clear a directory', (done) => {
		cache.clear()
			.on('data', (file) => {
				file.isNull().should.equal(true);
				done();
			})
			.end(new File());
	});

	it('cannot clear specific stream cache', (done) => {
		cache.clear()
			.on('error', (err) => {
				err.message.should.equal('Cannot operate on stream sources');
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

				fakeFileCache.removeCached.calledWith('somename', someKeyHash).should.equal(true);
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
