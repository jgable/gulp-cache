gulp-cache  ![status](https://secure.travis-ci.org/jgable/gulp-cache.png?branch=master)
==========

A temp file based caching proxy task for Gulp.

### Example

```javascript
gulp.task('lint', function() {
  gulp.src('./lib/*.js')
    .pipe(cache.proxy(jshint(".jshintrc"), {
      key: makeHashKey,
      success: function (jshintedFile) {
        return jshintedFile.jshint.success;
      },
      // What to store as the result of the successful action
      value: function (jshintedFile) {
        // Will be extended onto the file object on a cache hit next time task is ran
        return {
          jshint: jshintedFile.jshint
        };
      }
    })
    .pipe(jshint.reporter('default'));
});

var jsHintVersion = '2.4.1',
  jshintOptions = fs.readFileSync('.jshintrc');
function makeHashKey(file) {
  // Key off the file contents, jshint version and options
  return [file.contents.toString('utf8'), jshintVersion, jshintOptions].join('');
}
```

### License

The MIT License (MIT)

Copyright (c) 2014 Jacob Gable

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.