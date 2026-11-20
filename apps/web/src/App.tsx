import type { ReactElement } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { getCurrentUser, hasStockAccess } from "./lib/api";
import LoginPage from "./pages/LoginPage";
import EventsPage from "./pages/EventsPage";
import NewEventPage from "./pages/NewEventPage";
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
import SettingsLayout from "./components/SettingsLayout";
import HomeRedirect from "./pages/HomeRedirect";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import AdminWarehousesPage from "./pages/AdminWarehousesPage";
import WarehouseTransfersPage from "./pages/WarehouseTransfersPage";

function WarehouseOnly({ children }: { children: ReactElement }) {
  if (!hasStockAccess(getCurrentUser())) return <Navigate to="/inventory" replace />;
  return children;
}

function EventDetailRoute({ warehouse = false }: { warehouse?: boolean }) {
  const { id } = useParams();
  return warehouse ? <WarehouseEventDetailPage key={id} /> : <EventDetailPage key={id} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppShell />}>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/new" element={<NewEventPage />} />
        <Route path="/events/:id" element={<EventDetailRoute />} />
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
        <Route path="/warehouse/:id" element={<EventDetailRoute warehouse />} />
        <Route element={<SettingsLayout />}>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/password" element={<ChangePasswordPage />} />

          <Route path="/settings/users" element={<AdminUsersPage />} />
          <Route path="/settings/roles" element={<AdminRoleCategoriesPage />} />
          <Route path="/settings/categories" element={<AdminCategoriesPage />} />
          <Route path="/settings/items" element={<AdminItemsPage />} />
          <Route path="/settings/warehouses" element={<AdminWarehousesPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
