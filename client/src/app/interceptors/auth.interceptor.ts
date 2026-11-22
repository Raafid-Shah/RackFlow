import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import {
  SESSION_EXPIRED_EVENT,
  STAFF_STORAGE_KEY,
  TOKEN_STORAGE_KEY,
} from '../services/rackflow.store';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const headers: Record<string, string> = {};

  try {
    const staff = localStorage.getItem(STAFF_STORAGE_KEY);
    if (staff) headers['x-rackflow-staff'] = staff;

    const token = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (token && !req.headers.has('Authorization')) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {}

  const cloned = Object.keys(headers).length > 0 ? req.clone({ setHeaders: headers }) : req;

  return next(cloned).pipe(
    catchError((err: unknown) => {
      if (
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        !req.url.includes('/api/auth/verify') &&
        !req.url.includes('/api/auth/change-pin')
      ) {
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      }
      return throwError(() => err);
    }),
  );
};