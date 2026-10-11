import React, { useState } from 'react';
import { Box, Tabs, Tab, Typography, Paper, Chip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import Dashboard from '../components/Dashboard';
import CustomerList from '../components/CustomerList';
import { Person, Dashboard as DashboardIcon } from '@mui/icons-material';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ py: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `simple-tab-${index}`,
    'aria-controls': `simple-tabpanel-${index}`,
  };
}

const Home = () => {
  const [value, setValue] = useState(0);
  const theme = useTheme();

  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setValue(newValue);
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Box
        sx={{
          mb: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        <Box>
          <Typography
            variant="h4"
            sx={{
              fontWeight: 800,
              letterSpacing: '0.5px',
              color: theme.palette.primary.main,
            }}
          >
            Transport Manager Dashboard
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Track customers, trips and revenue in one clean view.
          </Typography>
        </Box>
        <Chip
          label="Live Business Overview"
          color="primary"
          sx={{
            borderRadius: 999,
            fontWeight: 600,
            px: 1,
          }}
        />
      </Box>

      <Paper
        elevation={0}
        sx={{
          borderRadius: 2,
          mb: 3,
          overflow: 'hidden',
          backgroundColor: 'transparent',
        }}
      >
        <Box
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Tabs
            value={value}
            onChange={handleTabChange}
            aria-label="Dashboard sections"
            sx={{
              minHeight: 0,
              '& .MuiTabs-flexContainer': {
                gap: 2,
              },
              '& .MuiTab-root': {
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '1rem',
                minHeight: 0,
                px: 2,
                py: 1.5,
                color: 'text.secondary',
                transition: 'all 0.2s ease-in-out',
              },
              '& .Mui-selected': {
                color: 'primary.main',
              },
              '& .MuiTabs-indicator': {
                backgroundColor: 'primary.main',
                height: 3,
                borderTopLeftRadius: 3,
                borderTopRightRadius: 3,
              },
            }}
          >
            <Tab
              label={
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <DashboardIcon sx={{ mr: 1, fontSize: 20 }} />
                  <Typography>Dashboard</Typography>
                </Box>
              }
              {...a11yProps(0)}
            />
            <Tab
              label={
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Person sx={{ mr: 1, fontSize: 20 }} />
                  <Typography>Customers</Typography>
                </Box>
              }
              {...a11yProps(1)}
            />
          </Tabs>
        </Box>
      </Paper>
      <TabPanel value={value} index={0}>
        <Dashboard />
      </TabPanel>
      <TabPanel value={value} index={1}>
        <CustomerList />
      </TabPanel>
    </Box>
  );
};

export default Home;
