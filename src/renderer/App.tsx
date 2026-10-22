import { ToastProvider } from './components';
import { AppProvider, useApp } from './shell/AppContext';
import { Shell } from './shell/Shell';
import { ExpensesPage } from './pages/ExpensesPage';
import { ExpenseEntryPage } from './pages/ExpenseEntryPage';
import { ReceiptReviewPage } from './pages/ReceiptReviewPage';
import { PropertiesPage } from './pages/PropertiesPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { ShowcasePage } from './pages/ShowcasePage';
import { SHOWCASE_ENABLED } from './env';

function Routes() {
  const { route } = useApp();
  switch (route.path) {
    case '/overview':
      return <PlaceholderPage title="Overview" what="Your portfolio summary will appear here once properties and expenses are saved." />;
    case '/properties':
      return <PropertiesPage />;
    case '/expenses':
      return <ExpensesPage />;
    case '/expenses/new':
      return <ExpenseEntryPage key={route.query.toString()} />;
    case '/receipts/review':
      return <ReceiptReviewPage />;
    case '/reports':
      return <PlaceholderPage title="Reports" what="Property profit, sold-property performance and expense reports will be added in a later stage." />;
    case '/settings':
      return <PlaceholderPage title="Settings" what="Company profiles, categories and backups will be added in later stages." />;
    case '/showcase':
      return SHOWCASE_ENABLED ? <ShowcasePage /> : <ExpensesPage />;
    default:
      return <ExpensesPage />;
  }
}

export function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <Shell>
          <Routes />
        </Shell>
      </AppProvider>
    </ToastProvider>
  );
}
