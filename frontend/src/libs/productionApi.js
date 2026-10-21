import axios from 'axios';
export function productionApi(admin = false) {
  const client = axios.create({ baseURL: `${import.meta.env.VITE_API_URL || 'http://localhost:3000/api'}/production` });
  client.interceptors.request.use(config => {
    const token = localStorage.getItem(admin ? 'token' : 'production_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });
  return client;
}
