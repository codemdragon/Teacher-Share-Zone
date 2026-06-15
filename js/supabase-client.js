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
    return await response.json();
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

  async addImage(groupId, originalUrl, cloudinaryPublicId) {
    return await this.request('/rest/v1/images', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        image_group_id: groupId,
        original_url: originalUrl,
        cloudinary_public_id: cloudinaryPublicId,
        annotations: []
      })
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
}

// Global Client instance
const db = new SupabaseClient();
window.db = db;
