import { HttpInterceptorFn } from '@angular/common/http';

export const PIN_STORAGE_KEY = 'rackflow-mod-pin';
export const STAFF_STORAGE_KEY = 'rackflow-staff-name';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api')) {
    return next(req);
  }

  const headers: Record<string, string> = {};
  try {
    const pin = sessionStorage.getItem(PIN_STORAGE_KEY);
    if (pin) headers['x-rackflow-pin'] = pin;

    const staff = localStorage.getItem(STAFF_STORAGE_KEY);
    if (staff) headers['x-rackflow-staff'] = staff;
  } catch {
    // Storage unavailable in restricted webview
  }

  if (Object.keys(headers).length === 0) {
    return next(req);
  }

  return next(req.clone({ setHeaders: headers }));
};