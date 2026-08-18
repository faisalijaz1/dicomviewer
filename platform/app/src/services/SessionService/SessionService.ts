import { PubSubService } from '@ohif/core';

const EVENTS = {
  SESSION_CHANGED: 'event::SessionService:sessionChanged',
};

class SessionService extends PubSubService {
  public static readonly REGISTRATION = {
    name: 'sessionService',
    altName: 'SessionService',
    create: ({ configuration = {} }) => {
      return new SessionService();
    },
  };

  private _authenticated: boolean = false;
  private _userId: string | null = null;
  private _fullName: string | null = null;
  private _roles: string[] = [];
  private _permissions: string[] = [];
  private _jwt: string | null = null;

  constructor() {
    super(EVENTS);
    this.EVENTS = EVENTS;
  }

  public async initialize(): Promise<void> {
    // Check URL for token (e.g. ?token=...)
    const urlParams = new URLSearchParams(window.location.search);
    let token = urlParams.get('token');

    if (token) {
      // Clear token from URL for security
      urlParams.delete('token');
      const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
      window.history.replaceState({}, document.title, newUrl);
      sessionStorage.setItem('ohif_jwt', token);
    } else {
      token = sessionStorage.getItem('ohif_jwt');
    }

    if (!token) {
      this._setAnonymous();
      return;
    }

    try {
      const payloadBase64 = token.split('.')[1];
      const payloadJson = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'));
      const payload = JSON.parse(payloadJson);
      
      if (payload.exp && (Date.now() >= payload.exp * 1000)) {
        console.warn('JWT token has expired locally');
        this._setAnonymous();
        return;
      }
    } catch (e) {
      console.error('Failed to decode JWT token', e);
      this._setAnonymous();
      return;
    }

    this._jwt = token;
    
    // Fetch session from pacs-api
    try {
      // Assuming pacs-api is hosted on localhost:8074 or configured via window.config
      const apiUrl = (window.config && window.config.pacsApiUrl) ? window.config.pacsApiUrl : 'http://192.192.8.173:8074';
      const response = await fetch(`${apiUrl}/api/session`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        this._authenticated = data.authenticated;
        this._userId = data.userId;
        this._fullName = data.fullName || data.name;
        this._roles = data.roles || [];
        this._permissions = data.permissions || [];
      } else {
        console.warn('Session API returned non-OK, reverting to anonymous mode');
        this._setAnonymous();
      }
    } catch (e) {
      console.error('Failed to fetch session, reverting to anonymous mode', e);
      this._setAnonymous();
    }

    this._broadcastChange();
  }

  private _setAnonymous() {
    this._authenticated = false;
    this._userId = null;
    this._fullName = null;
    this._roles = [];
    this._permissions = ['VIEW']; // Anonymous read-only permissions
    this._jwt = null;
    sessionStorage.removeItem('ohif_jwt');
  }

  private _broadcastChange() {
    this._broadcastEvent(this.EVENTS.SESSION_CHANGED, {
      authenticated: this._authenticated,
      userId: this._userId,
      fullName: this._fullName,
      permissions: this._permissions,
    });
  }

  public isAuthenticated(): boolean {
    return this._authenticated && this.isTokenValid();
  }

  public isTokenValid(): boolean {
    if (!this._jwt) return false;
    try {
      const payloadBase64 = this._jwt.split('.')[1];
      const payloadJson = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'));
      const payload = JSON.parse(payloadJson);
      return !payload.exp || Date.now() < payload.exp * 1000;
    } catch (e) {
      return false;
    }
  }

  public hasPermission(permission: string): boolean {
    if (!this.isTokenValid()) {
      return false;
    }
    return this._permissions.includes(permission);
  }

  public getJwt(): string | null {
    return this._jwt;
  }

  public getFullName(): string | null {
    return this._fullName;
  }

  public getUserId(): string | null {
    return this._userId;
  }

  public getRoles(): string[] {
    return this._roles;
  }
}

export default SessionService;
