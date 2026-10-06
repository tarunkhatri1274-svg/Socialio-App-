import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getAuthToken, getCachedUser, clearAuthSession as clearSession } from "../../api/authToken"

const AuthContext = createContext({
  token: null,
  user: {},
  refreshAuth: async () => {},
  clearAuth: async () => {},
});

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState({});

  const refreshAuth = useCallback(async () => {
    const t = await getAuthToken();
    setToken(t || null);
    const u = await getCachedUser();
    setUser(u);
  }, []);

  const clearAuth = useCallback(async () => {
    await clearSession();
    setToken(null);
    setUser({});
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  return (
    <AuthContext.Provider value={{ token, user, refreshAuth, clearAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);