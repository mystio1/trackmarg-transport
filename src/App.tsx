import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Box, CircularProgress, CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { AppProvider } from './context/AppContext';
import { useAppContext } from './context/AppContext';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import Layout from './components/Layout';
import ScrollToTop from './components/ScrollToTop';
import PageTransition from './components/PageTransition';
import { ToastProvider } from './components/ToastProvider';
import Dashboard from './components/Dashboard';
import CustomerList from './components/CustomerList';
import CustomerDetails from './pages/CustomerDetails';
import AuthPage from './pages/AuthPage';
import AdminTripApprovals from './pages/AdminTripApprovals';
import DriverSubmitTrip from './pages/DriverSubmitTrip';
import DriverTrips from './pages/DriverTrips';
import BrandingSettings from './pages/BrandingSettings';
import DriverList from './pages/DriverList';
import DriverDetails from './pages/DriverDetails';
import AllTrips from './pages/AllTrips';
import AddTrip from './pages/AddTrip';
import MyBills from './pages/MyBills';
import DocumentReminders from './pages/DocumentReminders';
import VehicleList from './pages/VehicleList';
import VehicleDetails from './pages/VehicleDetails';
import SupportConsole from './pages/SupportConsole';
import { useMemo } from 'react';
import type {} from '@mui/x-date-pickers/AdapterDayjs';

// Shared easing curves — a soft, slightly-decelerated curve for most transitions, and a gentle
// overshoot for things that should feel like they have a little physical weight (card lifts,
// icon state changes). Kept as plain constants rather than theme.transitions.easing entries
// since MUI's default type only names four slots and augmenting it repo-wide isn't worth it for
// two extra curves used in a handful of styleOverrides.
const EASE_SOFT = 'cubic-bezier(0.4, 0, 0.2, 1)';
const EASE_SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

// Binance Professional Modern Theme with Dynamic Mode
const getDashboardTheme = (mode: 'light' | 'dark') => createTheme({
  palette: {
    mode,
    primary: {
      main: '#F0B90B', // Binance Gold
      contrastText: '#0B0E11', // Black text on gold
    },
    secondary: {
      main: '#0ECB81', // Binance Green
      contrastText: '#fff',
    },
    background: {
      default: mode === 'dark' ? '#0B0E11' : '#f4f6f8',
      paper: mode === 'dark' ? '#161A1E' : '#fff',
    },
    text: {
      primary: mode === 'dark' ? '#EAECEF' : '#1E2329',
      secondary: mode === 'dark' ? '#848E9C' : '#474D57',
    },
    error: {
      main: '#F6465D', // Binance Red
    },
    warning: {
      main: '#F0B90B',
    },
    info: {
      main: '#2B3139',
    },
    success: {
      main: '#0ECB81',
    },
    divider: mode === 'dark' ? '#2B3139' : 'rgba(0,0,0,0.08)',
  },
  typography: {
    fontFamily: 'Inter, Roboto, Arial, sans-serif',
    h4: { fontWeight: 800, letterSpacing: 0.5 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 600 },
    button: { fontWeight: 600, textTransform: 'none', letterSpacing: 0.2 },
    body1: { fontWeight: 500 },
    body2: { fontWeight: 400 },
  },
  shape: {
    borderRadius: 8, // Slightly sharper corners
  },
  transitions: {
    // Slightly quicker than MUI's stock 225-375ms band — fast enough to still feel responsive
    // rather than "animated for the sake of it", per the 150-300ms target.
    duration: { shortest: 120, shorter: 160, short: 200, standard: 220, complex: 260 },
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: mode === 'dark' ? '#0B0E11' : '#ffffff',
          color: mode === 'dark' ? '#EAECEF' : '#1E2329',
          borderBottom: `1px solid ${mode === 'dark' ? '#2B3139' : '#EAECEF'}`,
          boxShadow: 'none',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          backgroundColor: mode === 'dark' ? '#161A1E' : '#fff',
          boxShadow: 'none',
          border: `1px solid ${mode === 'dark' ? '#2B3139' : '#EAECEF'}`,
          transition: `transform 220ms ${EASE_SPRING}, box-shadow 220ms ${EASE_SOFT}, border-color 220ms ${EASE_SOFT}`,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          backgroundColor: mode === 'dark' ? '#161A1E' : '#fff',
          boxShadow: 'none',
          border: `1px solid ${mode === 'dark' ? '#2B3139' : '#EAECEF'}`,
        },
        // Soft layered elevation instead of MUI's default harsh single-shadow, for the handful of
        // spots (menus, popovers, dialogs) that use elevation > 0 rather than the flat/bordered
        // look the rest of the app uses.
        elevation1: { boxShadow: mode === 'dark' ? '0 2px 8px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.3)' : '0 2px 8px rgba(15,23,42,0.08), 0 1px 2px rgba(15,23,42,0.06)' },
        elevation2: { boxShadow: mode === 'dark' ? '0 4px 16px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.3)' : '0 4px 16px rgba(15,23,42,0.1), 0 2px 4px rgba(15,23,42,0.06)' },
        elevation8: { boxShadow: mode === 'dark' ? '0 12px 32px rgba(0,0,0,0.45), 0 4px 8px rgba(0,0,0,0.3)' : '0 12px 32px rgba(15,23,42,0.14), 0 4px 8px rgba(15,23,42,0.08)' },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontWeight: 600,
          padding: '8px 20px',
          boxShadow: 'none',
          transition: `transform 120ms ${EASE_SOFT}, background-color 160ms ${EASE_SOFT}, box-shadow 160ms ${EASE_SOFT}, border-color 160ms ${EASE_SOFT}, opacity 160ms ${EASE_SOFT}`,
          '&:hover': {
            boxShadow: 'none',
          },
          // Press feedback — every button in the app gets this for free. Skipped entirely under
          // prefers-reduced-motion (see index.css, which turns this transition/transform off globally).
          '&:active': {
            transform: 'scale(0.96)',
          },
          '&.Mui-disabled': {
            opacity: 0.5,
          },
          '&.Mui-focusVisible': {
            outline: '2px solid #F0B90B',
            outlineOffset: 2,
          },
        },
        containedPrimary: {
          backgroundColor: '#F0B90B',
          color: '#0B0E11',
          '&:hover': {
            backgroundColor: '#FCD535',
            boxShadow: '0 4px 16px rgba(240,185,11,0.35)',
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          transition: `transform 120ms ${EASE_SOFT}, background-color 160ms ${EASE_SOFT}`,
          '&:active': { transform: 'scale(0.92)' },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          borderRadius: 6,
          transition: `transform 120ms ${EASE_SOFT}, background-color 160ms ${EASE_SOFT}`,
        },
        clickable: {
          '&:active': { transform: 'scale(0.95)' },
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: mode === 'dark' ? '#2B3139' : '#EAECEF',
        },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          backgroundColor: mode === 'dark' ? '#1E2329' : '#fff',
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: mode === 'dark' ? '#2B3139' : '#EAECEF',
            transition: `border-color 160ms ${EASE_SOFT}`,
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: '#F0B90B',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#F0B90B',
            borderWidth: 2,
          },
        },
      },
    },
    MuiCheckbox: {
      styleOverrides: {
        root: {
          transition: `transform 120ms ${EASE_SPRING}, color 160ms ${EASE_SOFT}`,
          '&:active': { transform: 'scale(0.9)' },
        },
      },
    },
    MuiRadio: {
      styleOverrides: {
        root: {
          transition: `transform 120ms ${EASE_SPRING}, color 160ms ${EASE_SOFT}`,
          '&:active': { transform: 'scale(0.9)' },
        },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        root: {
          '& .MuiSwitch-thumb': {
            transition: `transform 200ms ${EASE_SPRING}`,
          },
          '& .MuiSwitch-track': {
            transition: `background-color 200ms ${EASE_SOFT}, opacity 200ms ${EASE_SOFT}`,
          },
        },
      },
    },
    MuiTooltip: {
      defaultProps: {
        enterDelay: 300,
        leaveDelay: 0,
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
    MuiSkeleton: {
      styleOverrides: {
        root: {
          borderRadius: 6,
        },
      },
    },
  },
});

// Everything that depends on being logged into a specific business — the normal loading/auth
// gate, then the role-based app routes. Split out from AppWithTheme so /support (below) can
// bypass all of it: that page works with no business session at all, using its own separate
// support-token flow instead.
const ClientApp = () => {
  const { user, authLoading } = useAppContext();

  if (authLoading) {
    return (
      <Box
        sx={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 2, bgcolor: 'background.default', color: 'text.primary',
          animation: 'fade-scale-in 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <CircularProgress sx={{ color: '#F0B90B' }} />
        <Box sx={{ color: 'text.secondary', fontWeight: 600 }}>Loading Transport Manager...</Box>
      </Box>
    );
  }

  if (!user) return <AuthPage />;

  return (
    <ToastProvider>
      <ScrollToTop />
      <Layout>
        <PageTransition>
          <Routes>
            {user.role === 'admin' ? (
              <>
                <Route path="/" element={<Dashboard />} />
                <Route path="/customers" element={<CustomerList />} />
                <Route path="/approvals" element={<AdminTripApprovals />} />
                <Route path="/customer/:id" element={<CustomerDetails />} />
                <Route path="/drivers" element={<DriverList />} />
                <Route path="/driver/:id" element={<DriverDetails />} />
                <Route path="/vehicles" element={<VehicleList />} />
                <Route path="/vehicle/:id" element={<VehicleDetails />} />
                <Route path="/trips" element={<AllTrips />} />
                <Route path="/add-trip" element={<AddTrip />} />
                <Route path="/my-bills" element={<MyBills />} />
                <Route path="/document-reminders" element={<DocumentReminders />} />
                <Route path="/settings" element={<BrandingSettings />} />
                {/* Unmatched paths (stale bookmark, driver-only route, typo) fall back home
                    instead of rendering a blank page. */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            ) : (
              <>
                <Route path="/" element={<DriverTrips />} />
                <Route path="/submit" element={<DriverSubmitTrip />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            )}
          </Routes>
        </PageTransition>
      </Layout>
    </ToastProvider>
  );
};

const AppWithTheme = () => {
  const { themeMode } = useAppContext();
  // Force dark mode for binance theme, but allow toggle if really wanted
  const activeMode = themeMode === 'light' ? 'light' : 'dark';
  const theme = useMemo(() => getDashboardTheme(activeMode), [activeMode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ color: 'text.primary', minHeight: '100vh', background: theme.palette.background.default }}>
        <Router>
          {/* /support is a separate, internal-only tool (see SupportConsole) that must work with
              no business session at all — everything else keeps needing a logged-in user. */}
          <Routes>
            <Route path="/support" element={<SupportConsole />} />
            <Route path="/*" element={<ClientApp />} />
          </Routes>
        </Router>
      </Box>
    </ThemeProvider>
  );
};

function App() {
  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <AppProvider>
        <AppWithTheme />
      </AppProvider>
    </LocalizationProvider>
  );
}

export default App;
