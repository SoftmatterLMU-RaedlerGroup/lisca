import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import AssaysPage from "@/pages/AssaysPage";
import AssayActionsPage from "@/pages/AssayActionsPage";
import InfoPage from "@/pages/InfoPage";
import RegisterPage from "@/pages/RegisterPage";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/assays" replace />} />
        <Route path="/assays" element={<AssaysPage />} />
        <Route path="/assays/new/actions" element={<AssayActionsPage />} />
        <Route path="/assays/:id/actions" element={<AssayActionsPage />} />
        <Route path="/assays/new/info" element={<InfoPage />} />
        <Route path="/assays/:id/info" element={<InfoPage />} />
        <Route path="/register/:id" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/assays" replace />} />
      </Routes>
    </HashRouter>
  );
}
