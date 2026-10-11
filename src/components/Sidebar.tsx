import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
  useTheme,
} from '@mui/material';
import { Dashboard, People, AssignmentTurnedIn, Send, Settings, LocalShipping, AddCircle, ReceiptLong, EventNote, Garage } from '@mui/icons-material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';

const drawerWidth = 260;

interface SidebarProps {
  mobileOpen: boolean;
  handleDrawerToggle: () => void;
}

const Sidebar = ({ mobileOpen, handleDrawerToggle }: SidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const { user, pendingTrips, group, activeDocumentReminders } = useAppContext();

  const expiringDocsCount = activeDocumentReminders.length;

  const navItems =
    user?.role === 'admin'
      ? [
          { text: 'Dashboard', icon: <Dashboard />, path: '/' },
          { text: 'Customers', icon: <People />, path: '/customers' },
          { text: 'Drivers', icon: <LocalShipping />, path: '/drivers' },
          { text: 'Vehicles', icon: <Garage />, path: '/vehicles' },
          { text: 'Add Trip', icon: <AddCircle />, path: '/add-trip' },
          {
            text: `Approvals${pendingTrips.length ? ` (${pendingTrips.length})` : ''}`,
            icon: <AssignmentTurnedIn />,
            path: '/approvals',
          },
          { text: 'My Bills', icon: <ReceiptLong />, path: '/my-bills' },
          {
            text: `Document Reminders${expiringDocsCount ? ` (${expiringDocsCount})` : ''}`,
            icon: <EventNote />,
            path: '/document-reminders',
          },
          { text: 'Bill Branding & Settings', icon: <Settings />, path: '/settings' },
        ]
      : [
          { text: 'My Trips', icon: <Dashboard />, path: '/' },
          { text: 'Submit Trip', icon: <Send />, path: '/submit' },
        ];

  const handleNavigation = (path: string) => {
    navigate(path);
  };

  const drawerContent = (
    <>
      <Box
        sx={{
          p: 3,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          // The drawer runs edge-to-edge on native, so its own top padding needs to clear a
          // phone's notch/status bar on top of the normal 24px visual gap — resolves to plain
          // 24px (no change) on anything without one.
          pt: 'calc(24px + env(safe-area-inset-top))',
        }}
      >
        {/* Transparent PNGs (cropped tight, alpha background) carrying the full
            "Transport Management / Powered by TrackMarg" wordmark, so they float directly on
            the drawer background — one per theme mode, since a single treatment doesn't read
            well in both: logo.png is designed for the dark sidebar and gets a soft white halo
            (a dark shadow would disappear against an already-dark background); logo-light.png
            is designed for the light sidebar and gets a conventional soft dark shadow instead,
            mirroring the same idea in reverse. drop-shadow (not box-shadow) so the glow follows
            the logo's actual silhouette instead of its rectangular bounding box. */}
        <Box
          component="img"
          src={theme.palette.mode === 'light' ? '/logo-light.png' : '/logo.png'}
          alt="Transport Management logo"
          sx={{
            width: '100%',
            maxWidth: 180,
            filter: theme.palette.mode === 'light'
              ? 'drop-shadow(0 2px 6px rgba(15,23,42,0.25))'
              : 'drop-shadow(0 0 8px rgba(255,255,255,0.55))',
          }}
        />
      </Box>
      <Divider sx={{ borderColor: 'divider' }} />
      <List sx={{ px: 2, pt: 3 }}>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path
            || (item.path !== '/' && location.pathname.startsWith(item.path))
            || (item.path === '/vehicles' && location.pathname.startsWith('/vehicle/'));
          return (
            <ListItem key={item.text} disablePadding sx={{ mb: 1 }}>
              <ListItemButton
                onClick={() => handleNavigation(item.path)}
                sx={{
                  borderRadius: 2,
                  backgroundColor: isActive ? 'rgba(240, 185, 11, 0.1)' : 'transparent',
                  color: isActive ? '#F0B90B' : 'text.secondary',
                  '&:hover': {
                    backgroundColor: isActive ? 'rgba(240, 185, 11, 0.15)' : 'rgba(255,255,255,0.05)',
                  },
                }}
              >
                <ListItemIcon sx={{ color: 'inherit', minWidth: 40 }}>
                  {item.icon}
                </ListItemIcon>
                <ListItemText 
                  primary={item.text} 
                  primaryTypographyProps={{ fontWeight: isActive ? 700 : 500 }} 
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
      
      <Box sx={{ flexGrow: 1 }} />
      <Box sx={{ p: 3, pb: 'calc(24px + env(safe-area-inset-bottom))' }}>
        <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}`, textAlign: 'center' }}>
           <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
             Group Code
           </Typography>
           <Typography variant="body2" sx={{ color: 'text.primary', fontWeight: 600 }}>
             {group?.code || user?.groupCode || 'LOGIN'}
           </Typography>
        </Box>
      </Box>
    </>
  );

  // Fixed sidebar only from 1024px up (desktop/laptop); phone AND tablet (below that) get the
  // slide-out drawer instead — a plain MUI breakpoint alias would cut over at 600 or 900px,
  // so this uses an explicit media query to land exactly on the 1024px tablet/desktop line.
  const DESKTOP_QUERY = '@media (min-width:1024px)';

  return (
    <Box
      component="nav"
      sx={{ width: 0, flexShrink: 0, [DESKTOP_QUERY]: { width: drawerWidth, flexShrink: 0 } }}
      aria-label="mailbox folders"
    >
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={handleDrawerToggle}
        ModalProps={{
          keepMounted: true, // Better open performance on mobile.
        }}
        sx={{
          display: 'block',
          [DESKTOP_QUERY]: { display: 'none' },
          '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth, backgroundColor: 'background.default', borderRight: `1px solid ${theme.palette.divider}` },
        }}
      >
        {drawerContent}
      </Drawer>
      <Drawer
        variant="permanent"
        sx={{
          display: 'none',
          [DESKTOP_QUERY]: { display: 'block' },
          '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth, backgroundColor: 'background.default', borderRight: `1px solid ${theme.palette.divider}` },
        }}
        open
      >
        {drawerContent}
      </Drawer>
    </Box>
  );
};

export default Sidebar;
