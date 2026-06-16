// Supabase Configuration
const SUPABASE_URL = "https://phcpobluzbizpqatyzio.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoY3BvYmx1emJpenBxYXR5emlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MzA0MDcsImV4cCI6MjA5NzAwNjQwN30.Ns7a351GoDH6TSGvtlYL-xk_sgasmUdcue_GPqklvs8";

class SupabaseClient {
  constructor() {
    this.url = SUPABASE_URL;
    this.key = SUPABASE_ANON_KEY;
    this.token = localStorage.getItem('supabase.auth.token') || null;
    this.user = JSON.parse(localStorage.getItem('supabase.auth.user')) || null;
  }

  // Common request helper
  async request(path, options = {}) {
    const headers = {
      'apikey': this.key,
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.url}${path}`, {
      cache: 'no-store',
      ...options,
      headers
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData.message || errData.error_description || `API Error: ${response.statusText}`;
      
      // Auto-logout on JWT expiration
      if (response.status === 401 || errMsg.toLowerCase().includes('jwt expired')) {
        this.signOut();
        window.location.href = 'index.html';
      }
      
      throw new Error(errMsg);
    }

    if (response.status === 204) return null; // No Content
    const text = await response.text();
    if (!text) return null; // Empty body (e.g. 201 Created with no Prefer header)
    return JSON.parse(text);
  }

  // Authentication Methods
  async signUp(email, password) {
    const data = await this.request('/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    
    // Auto login if session returned
    if (data.access_token) {
      this.setSession(data);
    }
    return data;
  }

  async signIn(email, password) {
    const data = await this.request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    this.setSession(data);
    return data;
  }

  setSession(data) {
    this.token = data.access_token;
    this.user = data.user;
    localStorage.setItem('supabase.auth.token', this.token);
    localStorage.setItem('supabase.auth.user', JSON.stringify(this.user));
  }

  signOut() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('supabase.auth.token');
    localStorage.removeItem('supabase.auth.user');
  }

  isLoggedIn() {
    return !!this.token;
  }

  // Database Access methods (PostgREST API wrappers)
  async getClasses() {
    return await this.request('/rest/v1/classes?select=*&order=created_at.desc');
  }

  async createClass(name) {
    if (!this.user) throw new Error("Unauthorized");
    return await this.request('/rest/v1/classes', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({ name, teacher_id: this.user.id })
    });
  }

  async deleteClass(classId) {
    return await this.request(`/rest/v1/classes?id=eq.${classId}`, {
      method: 'DELETE'
    });
  }

  async getStudents(classId) {
    let query = '/rest/v1/students?select=*';
    if (classId) {
      query += `&class_id=eq.${classId}`;
    }
    return await this.request(query + '&order=name.asc');
  }

  async createStudent(classId, name, password) {
    return await this.request('/rest/v1/students', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({ class_id: classId, name, password })
    });
  }

  async deleteStudent(studentId) {
    return await this.request(`/rest/v1/students?id=eq.${studentId}`, {
      method: 'DELETE'
    });
  }

  async getImageGroups(studentId) {
    let query = '/rest/v1/image_groups?select=*,classes(name),students(name)';
    if (studentId) {
      query += `&student_id=eq.${studentId}`;
    }
    return await this.request(query + '&order=created_at.desc');
  }

  // Student specific read without full auth session
  async getSharedImageGroupsForStudent(studentId) {
    // Shared check is handled by RLS policy, but we query explicitly
    return await this.request(`/rest/v1/image_groups?select=*&student_id=eq.${studentId}&shared=eq.true&order=created_at.desc`);
  }

  async createImageGroup(classId, studentId, name) {
    if (!this.user) throw new Error("Unauthorized");
    return await this.request('/rest/v1/image_groups', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        class_id: classId,
        student_id: studentId,
        teacher_id: this.user.id,
        name,
        shared: false
      })
    });
  }

  // Student-created image group (no teacher auth needed, uses anon key)
  async createStudentImageGroup(classId, studentId, name) {
    return await this.request('/rest/v1/image_groups', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        class_id: classId,
        student_id: studentId,
        name,
        shared: true,
        uploaded_by: 'student'
      })
    });
  }

  async deleteImageGroup(groupId) {
    return await this.request(`/rest/v1/image_groups?id=eq.${groupId}`, {
      method: 'DELETE'
    });
  }

  async shareImageGroup(groupId, shared = true) {
    return await this.request(`/rest/v1/image_groups?id=eq.${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify({ shared })
    });
  }

  async getImages(groupId) {
    return await this.request(`/rest/v1/images?select=*&image_group_id=eq.${groupId}&order=sort_order.asc`);
  }

  // Get max sort_order for a group so new images continue from the right page number
  async getMaxSortOrder(groupId) {
    const rows = await this.request(`/rest/v1/images?select=sort_order&image_group_id=eq.${groupId}&order=sort_order.desc&limit=1`);
    if (rows && rows.length > 0 && rows[0].sort_order != null) {
      return rows[0].sort_order;
    }
    return 0;
  }

  async addImage(groupId, originalUrl, cloudinaryPublicId, uploadedBy = 'teacher', sortOrder = null) {
    const body = {
      image_group_id: groupId,
      original_url: originalUrl,
      cloudinary_public_id: cloudinaryPublicId,
      annotations: [],
      uploaded_by: uploadedBy
    };
    if (sortOrder !== null) body.sort_order = sortOrder;
    return await this.request('/rest/v1/images', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(body)
    });
  }

  async deleteImage(imageId) {
    return await this.request(`/rest/v1/images?id=eq.${imageId}`, {
      method: 'DELETE'
    });
  }

  async updateImageAnnotations(imageId, annotations) {
    return await this.request(`/rest/v1/images?id=eq.${imageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ annotations })
    });
  }

  async updateImageDraftAnnotations(imageId, draftAnnotations) {
    return await this.request(`/rest/v1/images?id=eq.${imageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ draft_annotations: draftAnnotations })
    });
  }

  async publishAnnotations(imageId, annotations) {
    return await this.request(`/rest/v1/images?id=eq.${imageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ annotations, draft_annotations: annotations })
    });
  }

  async updateClassUploadSettings(classId, enabled) {
    return await this.request(`/rest/v1/classes?id=eq.${classId}`, {
      method: 'PATCH',
      body: JSON.stringify({ student_uploads_enabled: enabled })
    });
  }

  async updateStudentUploadSettings(studentId, enabled) {
    return await this.request(`/rest/v1/students?id=eq.${studentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ uploads_enabled: enabled })
    });
  }

  async getStudentDetails(studentId) {
    return await this.request(`/rest/v1/students?select=*,classes(student_uploads_enabled)&id=eq.${studentId}`);
  }

  async createNotification(teacherId, studentId, message) {
    return await this.request('/rest/v1/notifications', {
      method: 'POST',
      body: JSON.stringify({ teacher_id: teacherId, student_id: studentId, message })
    });
  }

  async getNotifications(teacherId, studentId) {
    let query = '/rest/v1/notifications?select=*&read=eq.false';
    if (teacherId) query += `&teacher_id=eq.${teacherId}`;
    if (studentId) query += `&student_id=eq.${studentId}`;
    return await this.request(query + '&order=created_at.desc');
  }

  async markNotificationsAsRead(teacherId, studentId) {
    let query = `/rest/v1/notifications?read=eq.false`;
    if (teacherId) query += `&teacher_id=eq.${teacherId}`;
    if (studentId) query += `&student_id=eq.${studentId}`;
    return await this.request(query, {
      method: 'PATCH',
      body: JSON.stringify({ read: true })
    });
  }
}

// ─── IndexedDB Cache Manager ───────────────────────────────────────────────
class CacheManager {
  constructor(dbName = 'tsz_cache', version = 1) {
    this.dbName = dbName;
    this.version = version;
    this._db = null;
  }

  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version);
      req.onupgradeneeded = (e) => {
        const idb = e.target.result;
        if (!idb.objectStoreNames.contains('groups')) idb.createObjectStore('groups', { keyPath: 'id' });
        if (!idb.objectStoreNames.contains('images')) idb.createObjectStore('images', { keyPath: 'groupId' });
        if (!idb.objectStoreNames.contains('meta'))   idb.createObjectStore('meta',   { keyPath: 'key' });
      };
      req.onsuccess = (e) => { this._db = e.target.result; resolve(this._db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async _tx(storeName, mode = 'readonly') {
    const idb = await this.open();
    return idb.transaction(storeName, mode).objectStore(storeName);
  }

  async get(storeName, key) {
    const store = await this._tx(storeName);
    return new Promise((resolve) => {
      const r = store.get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
  }

  async put(storeName, value) {
    const store = await this._tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const r = store.put(value);
      r.onsuccess = () => resolve();
      r.onerror = (e) => reject(e.target.error);
    });
  }

  async getAll(storeName) {
    const store = await this._tx(storeName);
    return new Promise((resolve) => {
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => resolve([]);
    });
  }

  async clear(storeName) {
    const store = await this._tx(storeName, 'readwrite');
    return new Promise((resolve) => {
      store.clear();
      resolve();
    });
  }

  // Cache groups for a student, storing a timestamp
  async cacheGroups(studentId, groups) {
    await this.put('meta', { key: `groups_${studentId}`, ts: Date.now() });
    for (const g of groups) {
      await this.put('groups', g);
    }
  }

  async getCachedGroups(studentId, maxAgeMs = 60000) {
    const meta = await this.get('meta', `groups_${studentId}`);
    if (!meta || (Date.now() - meta.ts) > maxAgeMs) return null; // stale
    const all = await this.getAll('groups');
    return all.filter(g => g.student_id === studentId);
  }

  // Cache images for a group
  async cacheImages(groupId, images) {
    await this.put('images', { groupId, data: images, ts: Date.now() });
  }

  async getCachedImages(groupId, maxAgeMs = 60000) {
    const entry = await this.get('images', groupId);
    if (!entry || (Date.now() - entry.ts) > maxAgeMs) return null;
    return entry.data;
  }
}

window.cacheManager = new CacheManager();

// Simple URL-safe Base64-based reversing cipher for basic parameter obfuscation
window.obfuscateParams = function(classId, studentName, password) {
  const data = JSON.stringify({ classId, studentName, password });
  const b64 = btoa(unescape(encodeURIComponent(data)));
  return b64.split('').reverse().join('').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

window.deobfuscateParams = function(token) {
  try {
    // Add padding back if necessary
    let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    b64 = b64.split('').reverse().join('');
    const data = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(data);
  } catch (e) {
    console.error("Failed to decode token", e);
    return null;
  }
};

// Global Client instance
const db = new SupabaseClient();
window.db = db;
