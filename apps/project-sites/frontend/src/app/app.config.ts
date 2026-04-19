import { ApplicationConfig, APP_INITIALIZER, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { routes } from './app.routes';
import { firstValueFrom } from 'rxjs';

/** Preload translations before the app renders — prevents flash of raw keys */
function initTranslations(translate: TranslateService) {
  return () => {
    translate.setDefaultLang('en');
    const browserLang = translate.getBrowserLang();
    const lang = browserLang === 'es' ? 'es' : 'en';
    return firstValueFrom(translate.use(lang));
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideAnimations(),
    importProvidersFrom(
      TranslateModule.forRoot({
        defaultLanguage: 'en',
      })
    ),
    provideTranslateHttpLoader({ prefix: './assets/i18n/', suffix: '.json' }),
    {
      provide: APP_INITIALIZER,
      useFactory: initTranslations,
      deps: [TranslateService],
      multi: true,
    },
  ],
};
