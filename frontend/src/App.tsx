import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { Orders } from './pages/Orders';
import { NewOrder } from './pages/NewOrder';
import { OrderDetail } from './pages/OrderDetail';
import { Bill } from './pages/Bill';
import { Customers } from './pages/Customers';
import { Reports } from './pages/Reports';
import { Staff } from './pages/Staff';
import { PublicOrder } from './pages/PublicOrder';
import { NotFound } from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      {/* Public: no auth, opened by a customer scanning the order QR code */}
      <Route path="/o/:token" element={<PublicOrder />} />

      <Route path="/login" element={<Login />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/orders" replace />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/new" element={<NewOrder />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/customers" element={<Customers />} />
      </Route>

      {/* Admin-only screens */}
      <Route
        element={
          <ProtectedRoute adminOnly>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/reports" element={<Reports />} />
        <Route path="/staff" element={<Staff />} />
      </Route>

      {/* Printable bill: standalone layout, no navigation chrome */}
      <Route
        path="/orders/:id/bill"
        element={
          <ProtectedRoute>
            <Bill />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
