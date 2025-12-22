import { Navigate } from "react-router-dom";
import { getCurrentUser } from "../lib/api";

export default function HomeRedirect() {
  const role = getCurrentUser()?.role ?? "";
  if (role === "warehouse") return <Navigate to="/warehouse" replace />;
  if (role === "admin") return <Navigate to="/events" replace />;
  return <Navigate to="/events" replace />;
}

