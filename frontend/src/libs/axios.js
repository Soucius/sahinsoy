import axios from "axios";
import { ENV } from "../../../backend/src/libs/env";

const api = axios.create({
    baseURL: ENV.VITE_API_URL || "http://localhost:3000/api"
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem("token");

    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
}, (error) => {
    return Promise.reject(error);
});

export default api;