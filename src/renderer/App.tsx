import { ToastProvider } from './components';
import { AppProvider, useApp } from './shell/AppContext';
import { Shell } from './shell/Shell';
import { ExpensesPage } from './pages/ExpensesPage';
import { ExpenseEntryPage } from './pages/ExpenseEntryPage';
import { ReceiptReviewPage } from './pages/ReceiptReviewPage';
import { PropertiesPage } from './pages/PropertiesPage';
import { PropertyEditPage } from './pages/PropertyEditPage';
import { PropertyDetailPage } from './pages/PropertyDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { CompanyEditPage } from './pages/CompanyEditPage';
import { SetupPage } from './pages/SetupPage';
import { OverviewPage } from './pages/OverviewPage';
import { ReportsPage } from './pages/ReportsPage';
import { ShowcasePage } from './pages/ShowcasePage';
import { SHOWCASE_ENABLED } from './env';

function Routes() {
  const { route } = useApp();
  switch (route.path) {
    case '/overview':
      return <OverviewPage />;
    case '/properties':
      return <PropertiesPage />;
    case '/properties/new':
    case '/properties/edit':
      return <PropertyEditPage key={route.path + route.query.toString()} />;
    case '/properties/view':
      return <PropertyDetailPage key={route.query.toString()} />;
    case '/expenses':
      return <ExpensesPage />;
    case '/expenses/new':
    case '/expenses/edit':
      return <ExpenseEntryPage key={route.path + route.query.toString()} />;
    case '/receipts/review':
      return <ReceiptReviewPage />;
    case '/reports':
      return <ReportsPage key={route.query.toString()} />;
    case '/settings':
      return <SettingsPage />;
    case '/settings/categories':
      return <CategoriesPage />;
    case '/settings/company':
      return <CompanyEditPage key={route.query.toString()} />;
    case '/showcase':
      return SHOWCASE_ENABLED ? <ShowcasePage /> : <ExpensesPage />;
    default:
      return <PropertiesPage />;
  }
}

function Gate() {
  const { companies } = useApp();
  if (companies.length === 0) return <SetupPage />;
  return (
    <Shell>
      <Routes />
    </Shell>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <Gate />
      </AppProvider>
    </ToastProvider>
  );
}
