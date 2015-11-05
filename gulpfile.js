var args = require('minimist')(process.argv.slice(2), {
    'default': {
      'rules': 'sparse',
      'buildNum': '0',
      'branch': 'local',
      'revision': 'git-revision',
      'buildTimeStamp': new Date().toISOString()
    }
  }),
  exitReport = {},
  rulesPath = './config/gulp-'+args.rules+'.json',
  rules = require(rulesPath),
  gulp = require('gulp'),
  gulpif = require('gulp-if'),
  lazypipe = require('lazypipe'),
  del = require('del'),
  util = require('gulp-util'),
  jade = require('gulp-jade'),
  nodemon = require('gulp-nodemon'),
  connect = require('gulp-connect'),
  concat = require('gulp-concat'),
  sourcemaps = require('gulp-sourcemaps'),
  path = require('path'),
  uglify = require('gulp-uglify'),
  extend = require('util')._extend,
  EOL = require('os').EOL,
  kill = require('tree-kill'),
  fork = require('child_process').fork,
  exec = require('child_process').exec,
  merge = require('merge-stream'),
  minifyHtml = require('gulp-minify-html'),
  ngHtml2js = require('gulp-ng-html2js'),
  ngAnnotate = require('gulp-ng-annotate'),
  debug = require('gulp-debug'),
  minifyCss = require('gulp-minify-css'),
  less = require('gulp-less'),
  karma = require('karma').server,
  stylish = require('jshint-stylish'),
  source = require('vinyl-source-stream'),
  runSequence = require('run-sequence').use(gulp),
  jshint = require('gulp-jshint'),
  replace = require('gulp-replace'),
  traceur = require('traceur'),
  amd = require('amd-optimize'),
  through = require('gulp-through'),
  ignorePaths = [],
  promode = rules.promode_path,
  out = './build';

function sequence(tasks) {
  return function(cb) {
    runSequence.apply(this, tasks.concat([cb]));
  }
}

function task(name, dependencies) {
  return gulp.task(name, sequence(dependencies));
}

function compileES6(options) {
  var defaults = {
    sourceMaps: 'inline',
    arrayComprehension: true
  };

  options = extend(defaults, options);

  return through('traceur', function(file) {
    var filename = path.basename(file.path);
    var compiler = new traceur.NodeCompiler(options);
    var es5 = compiler.compile(String(file.contents), filename, filename);
//    var sourceMap = new Buffer(compiler.getSourceMap()).toString('base64');
    file.contents = new Buffer(es5/* + EOL + '//# sourceMappingURL=data:application/json;base64,' + sourceMap*/);
  })();
}

function buildVersion() {
  var build = {};
  try {
    var package = require(out + '/package');
    build = package.build;
    build.version = package.version;
  } catch (e) {}
  return build;
}

function remove(tries, path) {
  var n = 0;
  return function r() {
    n++;
    var err = del.sync(path, {force: true});
    return (err && (n < tries)) ? r() : err;
  }
}

// TASKS
gulp.task('clean', function(cb) {
  cb(remove(2, out)());
});

gulp.task('jsHint', function() {
  return gulp.src('./src/**/*.js')
    .pipe(jshint('.jshintrc'))
    .pipe(jshint.reporter(stylish))
    .pipe(gulpif(rules.fail_on_jsint, jshint.reporter('fail')));
});

gulp.task('karma', function() {
  var config = { configFile: path.resolve('./config/karma.conf.js') };
  karma.start(config, function(exitCode) {
    process.exit(exitCode);
  });
});

gulp.task('karma:ci', function(cb) {
  var config = path.resolve('./config/karma-ci.conf.js');
  karma.start({configFile: config}, function(exitCode) {
    exitCode = parseInt(exitCode);
    exitReport.status |= exitCode;
    exitReport.karma = exitCode === 0 ? 'pass' : 'fail';
    cb();
  });
});

gulp.task('compile:scripts', function() {
  return gulp.src(['src/**/*.js', '!src/**/*-e2e_*.js', '!src/**/*-spec.js']) // compile sources, exclude tests
    .pipe(compileES6({modules: 'amd'}))
    .pipe(gulp.dest(out));
});

gulp.task('compile:tests:e2e', function() {
  return gulp.src(['src/**/*e2e_spec.js', 'src/**/*e2e_po.js'])
    .pipe(compileES6({modules: 'commonjs'}))
    .pipe(gulp.dest(out));
});

gulp.task('compile:tests:unit', function() {
  return gulp.src('src/**/*-spec.js')
    .pipe(compileES6({modules: 'amd'}))
    .pipe(gulp.dest(out));
});

gulp.task('bundle:scripts', function() {
  return gulp.src('build/**/*.js')
    .pipe(amd('main', {
      paths: ignorePaths.reduce(function(paths, path) {
        paths[path] = 'empty:';
        return paths;
      }, {}),
      baseUrl: out
    }))
    .pipe(sourcemaps.init())
    .pipe(ngAnnotate())
    .pipe(uglify())
    .pipe(concat('sources.min.js'))
    .pipe(sourcemaps.write('.'))
    .pipe(gulp.dest(out));
});

gulp.task('clean:bundle', function(cb) {
  cb(remove(2, ['build/**/*',
    '!build/.e2e',
    '!build/*bundle.min.js.map',
    '!build/*bundle.min.js',
    '!build/axe-resources/*styles*.css',
    '!build/axe-resources/**',
    '!build/package.json',
    '!build/npm-shrinkwrap.json',
    '!build/*.html'].concat(rules.sparse ? [] : [
    'build/axe-resources/promode.css'
  ]))());
});

gulp.task('bundle:html2Js', function() {
  return gulp.src([
      'build/**/*.html',
      '!build/**/bower_components/**/*.html',
      '!build/**/external_libs/**/*.html',
      '!build/**/lib/**/*.html',
      '!build/**/index.html'
    ])
    .pipe(minifyHtml({ spare: true, quotes: true, empty: true }))
    .pipe(ngHtml2js({ declareModule: false, moduleName: 'tplCache', prefix: '/'}))
    .pipe(concat('templates.min.js'))
    .pipe(ngAnnotate())
    .pipe(uglify())
    .pipe(gulp.dest(out));
});


gulp.task('styles', function() {
  var unminified = lazypipe().pipe(concat, 'styles.css');
  var minified = lazypipe().pipe(minifyCss).pipe(concat, 'styles.min.css');

  return merge(
    gulp.src(rules.sparse ? [] : [promode+'/promode.css']),
    gulp.src(['src/**/*.less']).pipe(less({ strictMath: true }))
  )
    .pipe(gulpif(rules.sparse, unminified(), minified()))
    .pipe(gulp.dest(out + '/axe-resources'))
});

gulp.task('copy:templates', function () {
  return gulp.src('./src/**/*.html').pipe(gulp.dest(out));
});

gulp.task('copy:libs', function() {
  return gulp.src('./bower_components/**')
    .pipe(gulp.dest(out + '/bower_components'));
});

gulp.task('copy:ext-libs', function() {
  return gulp.src('./external_libs/**')
    .pipe(gulp.dest(out + '/external_libs'));
});

gulp.task('copy:promode', function() {
  return gulp.src(promode+'/promode*.*').pipe(gulp.dest(out + '/axe-resources'));
});

gulp.task('copy:resources', function() {
  var resources = gulp.src([
    'src/axe-resources/**', promode+'/promode*.{css,js}'
  ]).pipe(gulp.dest(out + '/axe-resources'));
  var json = gulp.src('src/**/*.json').pipe(gulp.dest(out));
  return merge(resources, json);
});

gulp.task('copy:package.json', function () {
  return gulp.src(['package.json','npm-shrinkwrap.json']).pipe(gulp.dest(out));
});

// "version": 0.X.0
// where the X can be modified in package.json
gulp.task('version:package.json', function() {
  var major = (args.branch === 'master' ?  '1' : '0');
  gulp.src('build/package.json')
    .pipe(replace(/("version":) "0\.(\d+)\.0"/,
      '$1 "'+ major +'.$2.' + args.buildNum + '"'))
    .pipe(replace(/\$\{buildTimeStamp\}/, args.buildTimeStamp))
    .pipe(replace(/\$\{branchName\}/, args.branch))
    .pipe(replace(/\$\{revision\}/, args.revision))
    .pipe(gulp.dest(out));
});

gulp.task('kill', function() {
  console.log('CI RESULTS: ' + JSON.stringify(exitReport));
  process.exit(exitReport.status);
});

gulp.task('concat:scripts&templates', function() {
  return gulp.src(['build/sources.min.js', 'build/templates.min.js'])
    .pipe(sourcemaps.init({loadMaps: '/sources.min.js.map'}))
    .pipe(concat('bundle.min.js'))
    .pipe(sourcemaps.write('.'))
    .pipe(gulp.dest(out + '/axe-resources'));
});

gulp.task('build', function(cb) {
  runSequence.apply(this, ['explode'].concat(rules.sparse ? [] : 'bundle').concat(cb));
});

gulp.task('compile:html', function() {
  var jadeVars = {
    config: { sparse: rules.sparse, mocks: rules.mocks },
    build: buildVersion()
  };
  console.log("jadeVars:", JSON.stringify(jadeVars));

  return gulp.src(['src/*.jade', '!src/base.jade'])
    .pipe(jade({pretty: true, locals: jadeVars}))
    .pipe(gulp.dest(out));
});

gulp.task('concat:libs', function(cb) {
  var bower = './bower_components';
  var ext = './external_libs';

  var minified = lazypipe().pipe(concat, 'lib-bundle.min.js');

  var unminified = lazypipe()
    .pipe(sourcemaps.init)
    .pipe(concat, 'lib-bundle.js')
    .pipe(sourcemaps.write, '.');

  gulp.src([
      path.resolve(ext, 'polyfill.js'),
      path.resolve(bower, 'traceur-runtime', 'traceur-runtime.js'),
      path.resolve(bower, 'angular', 'angular.js'),
      path.resolve(bower, 'angular-translate', 'angular-translate.js'),
      path.resolve(bower, 'angular-route', 'angular-route.js'),
      path.resolve(bower, 'angular-cookie', 'angular-cookie.js'),
      path.resolve(bower, 'angular-animate', 'angular-animate.js'),
      path.resolve(bower, 'Chart.js', 'Chart.js'),
      path.resolve(bower, 'bf-feature-throttle-directive', 'dist', 'bf-feature-throttle-directive.min.js'),
      path.resolve(ext, 'moment.min.js'),
      path.resolve(ext, 'moment-timezone.min.js'),
      path.resolve(bower, 'jstimezonedetect', 'jstz.min.js'),
      path.resolve(ext, 'ui-bootstrap-custom-tpls-0.12.1.js')
    ].concat(
    rules.sparse
      ? path.resolve(bower, 'requirejs', 'require.js')
      : [
      path.resolve(bower, 'amdlite', 'amdlite.min.js'),
      path.resolve(out, 'axe-resources', 'promode-config-gen.js'),
      path.resolve(out, 'axe-resources', 'promode.js')
    ]
    )
  ).pipe(gulpif(rules.sparse, unminified(), minified()))
    .pipe(gulp.dest(out + '/axe-resources'))
    .on('end', function() {
      cb(rules.sparse ? null : remove(2, ['build/axe-resources/promode*.js'])());
    });
});

gulp.task('connect', function() {
  nodemon({
    'verbose': false,
    'script' : './node/server',
    'watch'  : ['./node'],
    'ext'    : 'js',
    'env'    : {
      'rules'  : path.relative('./node', rulesPath),
      'static' : out
    }
  }).on('log', function(log) {
    if (log && log.type === 'fail' && rules.exit_on_error) {
      // forces build to fail, since we could be testing another build
      console.log('ERROR: nodemon server.js could not start (something running on same port?)');
      process.exit(1);
    }
  });
  if (rules.sparse) {
    connect.server({  // not used, just needed for livereload
      port: (rules.http + 10),
      livereload: true
    });
  }
});

gulp.task('watch', function() {
  var reloadable = 'build/**/*.{css,js,html}';

  gulp.watch(reloadable, function() {                                                         // if anything is changed in out directory
    return gulp.src(reloadable).pipe(connect.reload());                                       // reload
  });

  // styles section
  gulp.watch(
    ['src/**/*.less'],
    function(event) { return runSequence('styles'); }
  );

  // javascript section
  gulp.watch(
    ['src/**/*.js', '!src/**/*_spec.js', '!src/**/*_po.js'],
    function(event) {                                                                         // on change of a source:
      var r = /[\/\\]src[\/\\](.*)/,
        destination = out + '/' + r.exec(event.path)[1].replace('\\', '/'),
        unitDestination = out + '/' + r.exec(event.path)[1].replace('\\', '/');

      gulp.src(event.path).pipe(compileES6({modules: 'amd'})).pipe(gulp.dest(path.dirname(unitDestination)));
      return gulp.src(event.path).pipe(compileES6({modules: 'amd'}))                                 // compile and
        .pipe(gulp.dest(path.dirname(destination)));                                          // copy to out directory
    }
  );

  // e2e tests section
  gulp.watch(
    ['src/**/*e2e_spec.js', 'src/**/*e2e_po.js'],
    function(event) {
      var r = /[\/\\]src[\/\\](.*)/;
      var destination = out + '/' + r.exec(event.path)[1].replace('\\', '/');
      return gulp.src(event.path).pipe(compileES6({modules: 'commonjs'})).pipe(gulp.dest(path.dirname(destination)));
    });

  // html section
  gulp.watch(
    ['src/**/*.html'],
    function(event) {
      var r = /[\/\\]src[\/\\](.*)/;
      var destination = out + '/' + r.exec(event.path)[1].replace('\\', '/');
      return gulp.src(event.path).pipe(gulp.dest(path.dirname(destination)));
    }
  );

  //jade section
  gulp.watch(
    ['src/**/*.jade'],
    function(event) { return runSequence('compile:html'); }
  );

  // promode section
  gulp.watch(
    ['promode/**/*.{js,css}'],
    function(event) { return runSequence('copy:promode'); }
  );

});


gulp.task('compile:unittest:dependency', function() {
  return gulp.src([
    'bower_components/requirejs-plugins/lib/text.js',
    'bower_components/requirejs-plugins/src/json.js'
  ]).pipe(gulp.dest(out + '/.plugins'));
});

gulp.task('test:e2e', function(cb) {
  var env = Object.assign({}, process.env, {'rules': path.relative('./node', rulesPath), 'static': out});
  var srv = fork(path.join(__dirname, 'node/server.js'), [], {'env' : env}).on('message', function(msg) {
    if (msg === 'started') {
      var command = 'protractor ' + path.join(__dirname, './config/protractor.js');
      var protractor = exec(command, {'env' : env, 'cwd': __dirname});

      protractor.on('close', function(code) {
        kill(srv.pid, 'SIGKILL');
        cb(code);
      });
      protractor.stdout.on('data', function(data) {
        console.log(data.toString());
      });
    }
  });
});

// TASK BUNDLES.
// tasks in inner square brackets will be executed in parallel
task('copy', ['copy:templates', 'copy:libs', 'copy:ext-libs', 'copy:resources']);
task('compile', ['compile:scripts', 'styles', 'jsHint', 'compile:html']);
task('package.json', ['copy:package.json', 'version:package.json']);
task('explode', ['clean', 'package.json', 'compile', 'copy', 'compile:tests:unit', 'concat:libs', 'compile:unittest:dependency']);
task('bundle', ['bundle:scripts', 'bundle:html2Js', 'concat:scripts&templates', 'clean:bundle', 'compile:tests:e2e']);
task('test:ci', ['karma:ci', 'kill']);
task('start', ['explode', 'watch', 'connect']);
task('reconnect', ['watch', 'connect']);
task('host', ['build', 'connect']);  // for dev test box
task('default', ['build']);
