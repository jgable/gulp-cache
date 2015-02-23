'use strict';

var path = require('path'),
    _ = require('lodash-node'),
    crypto = require('crypto'),
    File = require('vinyl'),
    should = require('should'),
    through = require('through2'),
    sinon = require('sinon');


var cache = require('../');

require('mocha');

describe('gulp-cache', function() {
    var sandbox,
        fakeFileHandler,
        fakeTask;

    beforeEach(function(done) {
        sandbox = sinon.sandbox.create();

        // Spy on the fakeFileHandler to check if it gets called later
        fakeFileHandler = sandbox.spy(function(file, enc, cb) {
            file.ran = true;

            if (Buffer.isBuffer(file.contents)) {
                file.contents = new Buffer(String(file.contents) + '-modified');
            }

            cb(null, file);
        });
        fakeTask = through.obj(fakeFileHandler);

        cache.fileCache.clear('default', done);
    });

    afterEach(function() {
        sandbox.restore();
    });

    it('throws an error if no task is passed', function() {
        var shouldThrow = function() {
            cache();
        };

        shouldThrow.should.throw();
    });

    it('exposes the Cache object for creating custom Caches', function() {
        should.exist(cache.Cache);
    });

    describe('constructing a file should result in empty contents', function() {
        describe('constructor()', function() {
            it('empty constructor should create file without contents', function(done) {
                var file = new File();
                should.not.exist(file.contents);
                done();
            });
        });
        describe('check directory path results in empty File', function() {
            it('file contents should not exist', function(done) {
                var file = new File("../");
                should.not.exist(file.contents);
                done();
            });
        });
        describe('when passed a directory instead of a file (null mode)', function() {
            it('should bail gracefully on the defaultKey function', function(done) {
                // create the fake file
                var filePath = path.join('../'),
                    fakeFile = new File(filePath),
                    updatedFileHandler = sandbox.spy(function(file, enc, cb) {
                        file.contents = new Buffer('abufferwiththiscontent');
                        cb(null, file);
                    });

                fakeTask = through.obj(updatedFileHandler);

                // Create a proxied plugin stream
                var proxied = cache(fakeTask);

                // write the fake file to it
                proxied.write(fakeFile);

                // wait for the file to come back out
                proxied.once('data', function(file) {
                    // Check original handler was called
                    updatedFileHandler.called.should.equal(true);

                    // Check the path is on there
                    file.path.should.equal(filePath);

                    updatedFileHandler.reset();

                    // Write the same file again, should be cached result
                    proxied.write(new File({
                        contents: new Buffer('abufferwiththiscontent')
                    }));

                    proxied.once('data', function(secondFile) {
                        // Check for same file path
                        should.exist(secondFile.path);
                        secondFile.path.should.equal(filePath);

                        // Check original handler was not called.
                        updatedFileHandler.called.should.equal(false);

                        done();
                    });
                });
            });
        });
    });

    describe('in streaming mode', function() {
        it('does not work', function(done) {
            // Create a proxied plugin stream
            var proxied = cache(fakeTask, {
                key: function(file, cb) {
                    // For testing async key generation
                    setTimeout(function() {
                        cb(null, '123');
                    }, 1);
                },
                value: function(file, cb) {
                    // For testing async value generation
                    setTimeout(function() {
                        cb(null, {
                            ran: file.ran,
                            cached: true
                        });
                    }, 1);
                }
            });

            proxied
                .on('error', function(err) {
                    err.message.should.equal('Cannot operate on stream sources');
                    done();
                })
                .end(new File({
                    contents: through()
                }));
        });
    });

    describe('in buffered mode', function() {
        it('can clear all the cache', function(done) {
            cache.clearAll(function(err) {
                done(err);
            });
        });

        it('can clear specific cache', function(done) {
            var fakeFileCache = {
                    removeCached: sandbox.spy(function(category, hash, cb) {
                        return cb();
                    })
                },
                someKeyHash = crypto.createHash('md5').update('somekey').digest('hex');

            cache.clear({
                    name: 'somename',
                    fileCache: fakeFileCache,
                    key: function() {
                        return 'somekey';
                    }
                })
                .on('data', function() {
                    fakeFileCache.removeCached.calledWith('somename', someKeyHash).should.equal(true);
                    done();
                })
                .end(new File({
                    contents: new Buffer('something')
                }));
        });

        it('only caches successful tasks', function(done) {
            // Create a proxied plugin stream
            var valStub = sandbox.stub().returns({
                ran: true,
                cached: true
            });

            cache(fakeTask, {
                    success: function() {
                        return false;
                    },
                    value: valStub
                })
                .on('data', function() {
                    valStub.called.should.equal(false);
                    done();
                })
                .end(new File({
                    contents: new Buffer('abufferwiththiscontent')
                }));
        });

        it('sets the content correctly on subsequently ran cached tasks', function(done) {
            // Create a proxied plugin stream
            var proxied = cache(fakeTask, {
                success: function() {
                    return true;
                }
            });

            proxied.once('data', function(file) {
                String(file.contents).should.equal('abufferwiththiscontent-modified');

                proxied.once('data', function(file2) {
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

        it('can proxy a task with specific options', function(done) {
            // create the fake file
            var fakeFile = new File({
                    contents: new Buffer('abufferwiththiscontent')
                }),
                otherFile = new File({
                    contents: new Buffer('abufferwiththiscontent')
                });

            // Create a proxied plugin stream
            var proxied = cache(fakeTask, {
                value: function(file) {
                    return {
                        ran: file.ran,
                        cached: true,
                        contents: (file.contents || file._contents)
                    };
                }
            });

            // write the fake file to it
            proxied.write(fakeFile);

            // wait for the file to come back out
            proxied.once('data', function(file) {
                // make sure it came out the same way it went in
                file.isBuffer().should.equal(true);

                // check the contents are same
                file.contents.toString('utf8').should.equal('abufferwiththiscontent-modified');

                // Check it assigned the proxied task result
                file.ran.should.equal(true);
                should.not.exist(file.cached);

                // Check the original task was called
                fakeFileHandler.called.should.equal(true);

                // Reset for the second run through
                fakeFileHandler.reset();

                // Write the same file again, should be cached result
                proxied.write(otherFile);

                proxied.once('data', function(secondFile) {
                    secondFile.isBuffer().should.equal(true);

                    String(secondFile.contents).should.equal('abufferwiththiscontent-modified');

                    // Cached value should have been applied
                    secondFile.ran.should.equal(true);
                    secondFile.cached.should.equal(true);

                    // Should not have called the original task
                    fakeFileHandler.called.should.equal(false);

                    done();
                });
            });
        });

        it('can proxy a task using task.cacheable', function(done) {
            // create the fake file
            var fakeFile = new File({
                    contents: new Buffer('abufferwiththiscontent')
                }),
                otherFile = new File({
                    contents: new Buffer('abufferwiththiscontent')
                });

            // Let the task define the cacheable aspects.
            fakeTask.cacheable = {
                key: sandbox.spy(function(file) {
                    return file.contents.toString('utf8');
                }),
                success: sandbox.stub().returns(true),
                value: sandbox.spy(function(file) {
                    return {
                        ran: true,
                        cached: true,
                        contents: file.contents || file._contents
                    };
                })
            };

            var proxied = cache(fakeTask);

            // write the fake file to it
            proxied.write(fakeFile);

            // wait for the file to come back out
            proxied.once('data', function(file) {
                // make sure it came out the same way it went in
                file.isBuffer().should.equal(true);

                // check the contents are same
                String(file.contents).should.equal('abufferwiththiscontent-modified');

                // Verify the cacheable options were used.
                fakeTask.cacheable.key.called.should.equal(true);
                fakeTask.cacheable.success.called.should.equal(true);
                fakeTask.cacheable.value.called.should.equal(true);

                _.invoke([
                    fakeTask.cacheable.key,
                    fakeTask.cacheable.success,
                    fakeTask.cacheable.value,
                    fakeFileHandler
                ], 'reset');

                // Write the same file again, should be cached result
                proxied.write(otherFile);

                proxied.once('data', function(secondFile) {
                    fakeTask.cacheable.key.called.should.equal(true);
                    fakeTask.cacheable.success.called.should.equal(false);
                    fakeTask.cacheable.value.called.should.equal(false);

                    // Should not have called the original task
                    fakeFileHandler.called.should.equal(false);

                    // Cached value should have been applied
                    secondFile.cached.should.equal(true);

                    done();
                });
            });
        });

        it('can proxy a task using task.cacheable with user overrides', function(done) {
            // create the fake file
            var fakeFile = new File({
                    contents: new Buffer('abufferwiththiscontent')
                }),
                otherFile = new File({
                    contents: new Buffer('abufferwiththiscontent')
                });

            // Let the task define the cacheable aspects.
            fakeTask.cacheable = {
                key: sandbox.spy(function(file) {
                    return String(file.contents);
                }),
                success: sandbox.stub().returns(true),
                value: sandbox.stub().returns({
                    ran: true,
                    cached: true
                })
            };

            var overriddenValue = sandbox.stub().returns({
                ran: true,
                cached: true,
                overridden: true
            });

            // write the fake file to it
            cache(fakeTask, {
                    value: overriddenValue
                })
                // wait for the file to come back out
                .once('data', function(file) {
                    // make sure it came out the same way it went in
                    file.isBuffer().should.equal(true);

                    // check the contents are same
                    String(file.contents).should.equal('abufferwiththiscontent-modified');

                    // Verify the cacheable options were used.
                    fakeTask.cacheable.key.called.should.equal(true);
                    fakeTask.cacheable.success.called.should.equal(true);
                    fakeTask.cacheable.value.called.should.equal(false);
                    overriddenValue.called.should.equal(true);

                    _.invoke([
                        fakeTask.cacheable.key,
                        fakeTask.cacheable.success,
                        fakeTask.cacheable.value,
                        overriddenValue,
                        fakeFileHandler
                    ], 'reset');

                    this.once('data', function(secondFile) {
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
                        })
                        // Write the same file again, should be cached result
                        .end(otherFile);
                })
                .write(fakeFile);
        });

        it('can be passed just a string for the value', function(done) {
            // create the fake file
            var fakeFile = new File({
                    contents: new Buffer('abufferwiththiscontent')
                }),
                otherFile = new File({
                    contents: new Buffer('abufferwiththiscontent')
                });

            // Create a proxied plugin stream
            cache(fakeTask, {
                    value: 'ran'
                })
                .once('data', function(file) {
                    // Check it assigned the proxied task result
                    file.ran.should.equal(true);

                    this.once('data', function(secondFile) {
                        // Cached value should have been applied
                        secondFile.ran.should.equal(true);
                        done();
                    });

                    // Write the same file again, should be cached result
                    this.end(otherFile);
                })
                .write(fakeFile);
        });

        it('can store changed contents of files', function(done) {
            // create the fake file
            var fakeFile = new File({
                    contents: new Buffer('abufferwiththiscontent')
                }),
                updatedFileHandler = sandbox.spy(function(file, enc, cb) {
                    file.contents = new Buffer('updatedcontent');
                    cb(null, file);
                });

            fakeTask = through.obj(updatedFileHandler);

            // Create a proxied plugin stream
            var proxied = cache(fakeTask);

            // write the fake file to it
            proxied.write(fakeFile);

            // wait for the file to come back out
            proxied.once('data', function(file) {
                // Check for updated content
                String(file.contents).should.equal('updatedcontent');

                // Check original handler was called
                updatedFileHandler.called.should.equal(true);

                updatedFileHandler.reset();

                this.once('data', function() {
                    String(file.contents).should.equal('updatedcontent');

                    // Check original handler was not called.
                    updatedFileHandler.called.should.equal(false);

                    done();
                });

                // Write the same file again, should be cached result
                this.end(new File({
                    contents: new Buffer('abufferwiththiscontent')
                }));
            });
        });

        it('does not throw memory leak warning when proxying tasks', function(done) {
            fakeTask = through.obj(function(file, enc, cb) {
                setTimeout(function() {
                    file.contents = new Buffer(file.contents.toString() + ' updated');

                    cb(null, file);
                }, 10);
            });

            var files = _.times(30, function(val, i) {
                    return new File({
                        contents: new Buffer('Test File ' + i)
                    });
                }),
                proxied = cache(fakeTask);

            var origMaxListeners = fakeTask._maxListeners;
            var errSpy = sandbox.spy(console, 'error');

            var processedCount = 0;
            proxied
                .on('data', function() {
                    processedCount += 1;
                })
                .on('finish', function() {
                    processedCount.should.equal(30);
                    errSpy.called.should.equal(false, 'Called console.error');
                    fakeTask._maxListeners.should.equal(origMaxListeners || 0);

                    done();
                });

            files.forEach(function(file) {
                proxied.write(file);
            });

            proxied.end();
        });

        it('sets the path on cached results', function(done) {
            // create the fake file
            var filePath = path.join(process.cwd(), 'test', 'fixtures', 'in', 'file1.txt'),
                fakeFile = new File({
                    path: filePath,
                    contents: new Buffer('abufferwiththiscontent')
                }),
                updatedFileHandler = sandbox.spy(function(file, enc, cb) {
                    file.contents = new Buffer('updatedcontent');

                    cb(null, file);
                });

            fakeTask = through.obj(updatedFileHandler);

            // Create a proxied plugin stream
            var proxied = cache(fakeTask);

            // write the fake file to it
            proxied.write(fakeFile);

            // wait for the file to come back out
            proxied.once('data', function(file) {
                // Check original handler was called
                updatedFileHandler.called.should.equal(true);

                // Check the path is on there
                file.path.should.equal(filePath);

                updatedFileHandler.reset();

                // Write the same file again, should be cached result
                proxied.write(new File({
                    contents: new Buffer('abufferwiththiscontent')
                }));

                proxied.once('data', function(secondFile) {
                    // Check for same file path
                    should.exist(secondFile.path);
                    secondFile.path.should.equal(filePath);

                    // Check original handler was not called.
                    updatedFileHandler.called.should.equal(false);

                    done();
                });
            });
        });
    });
});
