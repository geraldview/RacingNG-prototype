import config from './config/client-config';
import translations from './config/locale-en';

/*jshint maxstatements: 38, maxcomplexity: 6*/
angular.module('app', [
    'tplCache', 'ngAnimate', 'ngRoute', 'ipCookie', 'pascalprecht.translate', 'Filters'
  ])
  .config(($locationProvider, $translateProvider, $routeProvider) => {

    $locationProvider.html5Mode(config.APP.PUSH_STATE);

    $translateProvider.preferredLanguage('en').translations('en', translations);

    $routeProvider.when('/',
      {
        templateUrl: '/components/app-view/app.html',
        controller: 'AppCtrl'
      }
    );
  })
  .run(() => {});