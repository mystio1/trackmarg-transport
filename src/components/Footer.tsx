import { Box, Container, Typography, Link, Divider } from '@mui/material';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import { useAppContext } from '../context/AppContext';

const Footer = () => {
  const currentYear = new Date().getFullYear();
  const { themeMode } = useAppContext();

  return (
    <Box
      component="footer"
      sx={{
        py: 3,
        px: 2,
        mt: 'auto',
        backgroundColor: (theme) => 
          themeMode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[100],
      }}
    >
      <Container maxWidth="sm">
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', mb: 1.5 }}>
          <LocalShippingIcon sx={{ mr: 1, color: 'primary.main', fontSize: 20 }} />
          <Typography variant="body1" color="primary.main" sx={{ fontWeight: 700, letterSpacing: '0.3px' }}>
            Transport Manager
          </Typography>
        </Box>
        <Divider sx={{ width: '40%', mx: 'auto', mb: 2, borderColor: themeMode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }} />
        <Typography variant="body2" color="text.secondary" align="center" sx={{ fontWeight: 500 }}>
          {'© '}
          <Link color="inherit" href="#" sx={{ fontWeight: 600, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
            Transport Manager
          </Link>{' '}
          {currentYear}
          {' — '}
          <span style={{ fontWeight: 600 }}>Premium Transport Solutions</span>
        </Typography>
      </Container>
    </Box>
  );
};

export default Footer;