'use strict';

var PassThrough = require('stream').PassThrough,
    should = require('should'),
    sinon = require('sinon'),
    es = require('event-stream'),
    gutil = require('gulp-util');

var cache = require('../index');

require('mocha');

describe('gulp-cache', function () {
    var fakeFileHandler,
        fakeTask;

    beforeEach(function (done) {
        // Spy on the fakeFileHandler to check if it gets called later
        fakeFileHandler = sinon.spy(function (file, cb) {
            file.ran = true;
            
            cb(null, file);
        }),
        fakeTask = es.map(fakeFileHandler);

        cache.fileCache.clear('test', function (err) {
            done(err);
        });
    });

    describe('in streaming mode', function () {
        it('can proxy a task', function (done) {
            // create the fake file
            var fakeStream = new PassThrough(),
                fakeFile = new gutil.File({
                    contents: fakeStream
                });

            // Create a proxied plugin stream
            var proxied = cache.proxy('test', {
                task: fakeTask,
                key: function (file, cb) {
                    // For testing async key generation
                    setTimeout(function () {
                        cb(null, '123');
                    }, 1);
                },
                success: function () {
                    return true;
                },
                value: function (file, cb) {
                    // For testing async value generation
                    setTimeout(function () {
                        cb(null, {
                            ran: file.ran,
                            cached: true
                        });
                    }, 1);
                }
            });

            // write the fake file to it
            proxied.write(fakeFile);

            // wait for the file to come back out
            proxied.once('data', function (file) {

                // make sure it came out the same way it went in
                file.isStream().should.equal(true);
                
                // Check it assigned the proxied task result
                file.ran.should.equal(true);
                should.not.exist(file.cached);

                // Check the original task was called
                fakeFileHandler.called.should.equal(true);

                // Reset for the second run through
                fakeFileHandler.reset();

                // Write the same file again, should be cached result
                proxied.write(fakeFile);

                proxied.once('data', function (secondFile) {
                    // make sure it came out the same way it went in
                    secondFile.isStream().should.equal(true);

                    // Cached value should have been applied
                    secondFile.ran.should.equal(true);
                    secondFile.cached.should.equal(true);

                    // Should not have called the original task
                    fakeFileHandler.called.should.equal(false);

                    done();
                });
            });
        });
    });

    describe('in buffered mode', function () {
        it('can proxy a task', function (done) {
            // create the fake file
            var fakeFile = new gutil.File({
                    contents: new Buffer('abufferwiththiscontent')
                });

            // Create a proxied plugin stream
            var proxied = cache.proxy('test', {
                task: fakeTask,
                key: function (file) {
                    return file.contents.toString('utf8');
                },
                success: function () {
                    return true;
                },
                value: function (file) {
                    return {
                        ran: file.ran,
                        cached: true
                    };
                }
            });

            // write the fake file to it
            proxied.write(fakeFile);

            // wait for the file to come back out
            proxied.once('data', function (file) {
                // make sure it came out the same way it went in
                file.isBuffer().should.equal(true);

                // check the contents are same
                file.contents.toString('utf8').should.equal('abufferwiththiscontent');

                // Check it assigned the proxied task result
                file.ran.should.equal(true);
                should.not.exist(file.cached);

                // Check the original task was called
                fakeFileHandler.called.should.equal(true);

                // Reset for the second run through
                fakeFileHandler.reset();

                // Write the same file again, should be cached result
                proxied.write(fakeFile);

                proxied.once('data', function (secondFile) {
                    // make sure it came out the same way it went in
                    secondFile.isBuffer().should.equal(true);

                    // check the contents are same
                    secondFile.contents.toString('utf8').should.equal('abufferwiththiscontent');

                    // Cached value should have been applied
                    secondFile.ran.should.equal(true);
                    secondFile.cached.should.equal(true);

                    // Should not have called the original task
                    fakeFileHandler.called.should.equal(false);

                    done();
                });
            });
        });
    });
});