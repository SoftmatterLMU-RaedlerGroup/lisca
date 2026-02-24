import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import SetupPage from "@/pages/SetupPage";
import WorkPage from "@/pages/WorkPage";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/setup" replace />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/setup/new" element={<SetupPage />} />
        <Route path="/setup/:id" element={<SetupPage />} />
        <Route path="/setup/new/info" element={<SetupPage />} />
        <Route path="/setup/:id/info" element={<SetupPage />} />
        <Route path="/work/:id" element={<WorkPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    </HashRouter>
  );
}
