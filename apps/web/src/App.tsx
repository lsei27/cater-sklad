import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getCurrentUser } from "./lib/api";
import LoginPage from "./pages/LoginPage";
import EventsPage from "./pages/EventsPage";
import EventDetailPage from "./pages/EventDetailPage";
import InventoryPage from "./pages/InventoryPage";

import AdminUsersPage from "./pages/AdminUsersPage";
import AdminCategoriesPage from "./pages/AdminCategoriesPage";
import AdminItemsPage from "./pages/AdminItemsPage";
import AdminRoleCategoriesPage from "./pages/AdminRoleCategoriesPage";
import AppShell from "./components/AppShell";
import WarehouseEventsPage from "./pages/WarehouseEventsPage";
import WarehouseEventDetailPage from "./pages/WarehouseEventDetailPage";
import SettingsPage from "./pages/SettingsPage";
import HomeRedirect from "./pages/HomeRedirect";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import AdminWarehousesPage from "./pages/AdminWarehousesPage";
import WarehouseTransfersPage from "./pages/WarehouseTransfersPage";

function WarehouseOnly({ children }: { children: ReactElement }) {
  const role = getCurrentUser()?.role;
  if (role !== "warehouse") return <Navigate to="/inventory" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppShell />}>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/:id" element={<EventDetailPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route
          path="/inventory/transfers"
          element={
            <WarehouseOnly>
              <WarehouseTransfersPage />
            </WarehouseOnly>
          }
        />
        <Route path="/warehouse" element={<WarehouseEventsPage />} />
        <Route path="/warehouse/:id" element={<WarehouseEventDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/password" element={<ChangePasswordPage />} />

        <Route path="/settings/users" element={<AdminUsersPage />} />
        <Route path="/settings/roles" element={<AdminRoleCategoriesPage />} />
        <Route path="/settings/categories" element={<AdminCategoriesPage />} />
        <Route path="/settings/items" element={<AdminItemsPage />} />
        <Route path="/settings/warehouses" element={<AdminWarehousesPage />} />
      </Route>
    </Routes>
  );
}
