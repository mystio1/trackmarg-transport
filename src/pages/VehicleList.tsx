import { useMemo, useState } from 'react';
import {
  Box, Typography, Card, CardContent, Avatar, List, Paper, TextField, InputAdornment, IconButton,
  Chip, useTheme, Button, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem,
} from '@mui/material';
import {
  Search, Clear, Add, Garage, LocalShipping, ArrowForward, Person, Speed, WarningAmber,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../components/ToastProvider';
import EmptyState from '../components/EmptyState';
import { ListRowsSkeleton } from '../components/Skeletons';
import { documentStatus } from '../utils/documentStatus';
import { currentOdometer, tripIncome, tripsForVehicle } from '../utils/vehicleStats';

// The four documents asked for up-front on the Add Vehicle form — all optional. Labels match the
// suggestions on the Document Reminders page so both screens talk about the same documents.
const ADD_FORM_DOCUMENTS = [
  { key: 'puc', label: 'PUC' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'fitness', label: 'Fitness Certificate' },
  { key: 'permit', label: 'Permit' },
] as const;

type DocKey = typeof ADD_FORM_DOCUMENTS[number]['key'];

const EMPTY_FORM = {
  vehicleNumber: '',
  assignedDriverId: '',
  puc: '',
  insurance: '',
  fitness: '',
  permit: '',
};

const VehicleList = () => {
  const { vehicles, trips, drivers, isLoading, addVehicle } = useAppContext();
  const navigate = useNavigate();
  const theme = useTheme();
  const toast = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const showSkeleton = isLoading && vehicles.length === 0;

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const vehicleStats = useMemo(() => vehicles.map(vehicle => {
    const vehicleTrips = tripsForVehicle(vehicle, trips);
    const docsNeedingAttention = vehicle.documents.filter(d => documentStatus(d).state !== 'ok').length;
    return {
      ...vehicle,
      totalTrips: vehicleTrips.length,
      totalIncome: tripIncome(vehicleTrips),
      odometer: currentOdometer(vehicle),
      docsNeedingAttention,
    };
  }), [vehicles, trips]);

  const visibleVehicles = vehicleStats.filter(v => {
    const q = searchTerm.trim().toLowerCase();
    return !q || v.vehicleNumber.toLowerCase().includes(q) || (v.assignedDriverName || '').toLowerCase().includes(q);
  });

  const totalTrips = vehicleStats.reduce((s, v) => s + v.totalTrips, 0);
  const totalIncome = vehicleStats.reduce((s, v) => s + v.totalIncome, 0);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setFormError('');
    setAddOpen(true);
  };

  const handleAdd = async () => {
    const vehicleNumber = form.vehicleNumber.trim();
    if (!vehicleNumber) {
      setFormError('Number plate is required');
      return;
    }
    const documents = ADD_FORM_DOCUMENTS
      .filter(d => form[d.key])
      .map(d => ({ label: d.label, expiryDate: form[d.key] }));

    setSaving(true);
    setFormError('');
    try {
      const vehicle = await addVehicle(vehicleNumber, {
        assignedDriverId: form.assignedDriverId || undefined,
        documents,
      });
      toast.success('Vehicle added.');
      setAddOpen(false);
      navigate(`/vehicle/${vehicle.id}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not add vehicle');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700, color: 'text.primary' }}>
            Vehicles
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            Every truck in your fleet — its driver, trips, income and maintenance.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={openAdd} sx={{ color: 'primary.contrastText', fontWeight: 700, whiteSpace: 'nowrap' }}>
          Add Vehicle
        </Button>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: { xs: 1.5, sm: 3 }, mb: 4 }}>
        <Card sx={{ height: { xs: '116px', sm: '140px' }, borderRadius: 2, background: theme.palette.background.paper, borderTop: '3px solid #F0B90B', color: 'text.primary', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}>
          <CardContent sx={{ p: { xs: 1.5, sm: 2 }, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: { xs: '0.75rem', sm: '1rem' } }}>Total Vehicles</Typography>
              <Avatar sx={{ bgcolor: 'rgba(240, 185, 11, 0.1)', color: '#F0B90B', width: { xs: 28, sm: 36 }, height: { xs: 28, sm: 36 } }}>
                <Garage sx={{ fontSize: { xs: 15, sm: 18 } }} />
              </Avatar>
            </Box>
            <Typography variant="h3" sx={{ fontWeight: 800, fontSize: { xs: '1.5rem', sm: '2.2rem' }, color: 'text.primary', lineHeight: 1 }}>
              {vehicles.length}
            </Typography>
          </CardContent>
        </Card>
        <Card sx={{ height: { xs: '116px', sm: '140px' }, borderRadius: 2, background: theme.palette.background.paper, borderTop: `3px solid ${theme.palette.divider}`, color: 'text.primary', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}>
          <CardContent sx={{ p: { xs: 1.5, sm: 2 }, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: { xs: '0.75rem', sm: '1rem' } }}>Total Trips</Typography>
              <Avatar sx={{ bgcolor: 'rgba(255, 255, 255, 0.05)', color: 'text.secondary', width: { xs: 28, sm: 36 }, height: { xs: 28, sm: 36 } }}>
                <LocalShipping sx={{ fontSize: { xs: 15, sm: 18 } }} />
              </Avatar>
            </Box>
            <Typography variant="h3" sx={{ fontWeight: 800, fontSize: { xs: '1.5rem', sm: '2.2rem' }, color: 'text.primary', lineHeight: 1 }}>
              {totalTrips}
            </Typography>
          </CardContent>
        </Card>
        <Card sx={{ height: { xs: '116px', sm: '140px' }, borderRadius: 2, background: theme.palette.background.paper, borderTop: '3px solid #0ECB81', color: 'text.primary', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gridColumn: { xs: 'span 2', md: 'span 1' } }}>
          <CardContent sx={{ p: { xs: 1.5, sm: 2 }, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: { xs: '0.75rem', sm: '1rem' } }}>Income Generated</Typography>
            <Typography variant="h3" sx={{ fontWeight: 800, fontSize: { xs: '1.15rem', sm: '2rem' }, color: 'text.primary', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              ₹{totalIncome.toFixed(2)}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      <TextField
        placeholder="Search by number plate or driver..."
        variant="outlined"
        size="small"
        value={searchTerm}
        onChange={e => setSearchTerm(e.target.value)}
        sx={{ width: { xs: '100%', sm: '320px' }, mb: 3 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Search sx={{ color: 'text.secondary' }} />
            </InputAdornment>
          ),
          endAdornment: searchTerm && (
            <InputAdornment position="end">
              <IconButton aria-label="clear search" onClick={() => setSearchTerm('')} edge="end" size="small" sx={{ color: 'text.secondary' }}>
                <Clear fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />

      <Paper elevation={0} sx={{ p: 3, borderRadius: 2, background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}` }}>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, color: 'text.primary' }}>
          All Vehicles
          <Typography component="span" variant="body2" sx={{ ml: 1, color: 'text.secondary' }}>
            ({visibleVehicles.length} {visibleVehicles.length === 1 ? 'vehicle' : 'vehicles'})
          </Typography>
        </Typography>

        {showSkeleton ? (
          <ListRowsSkeleton />
        ) : visibleVehicles.length === 0 ? (
          searchTerm ? (
            <EmptyState
              icon={<Search />}
              title="No vehicles match your search"
              description="Try a different number plate or driver name."
              action={{ label: 'Clear search', onClick: () => setSearchTerm('') }}
            />
          ) : (
            <EmptyState
              icon={<Garage />}
              title="No vehicles registered yet"
              description="Add your trucks to assign drivers, see trips and income per vehicle, and log maintenance."
              action={{ label: 'Add Vehicle', onClick: openAdd, icon: <Add /> }}
            />
          )
        ) : (
          <List sx={{ p: 0 }}>
            {visibleVehicles.map((vehicle, index) => (
              <Box
                key={vehicle.id}
                onClick={() => navigate(`/vehicle/${vehicle.id}`)}
                sx={{
                  mb: 1.5, p: 2, borderRadius: 2,
                  backgroundColor: index % 2 === 0 ? 'action.hover' : 'background.paper',
                  border: `1px solid ${theme.palette.divider}`,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: { xs: 'flex-start', sm: 'center' },
                  flexDirection: { xs: 'column', sm: 'row' },
                  gap: { xs: 1, sm: 0 },
                  transition: 'all 0.2s ease-in-out',
                  '&:hover': { backgroundColor: 'divider', borderLeft: '4px solid #F0B90B' },
                }}
              >
                <Avatar sx={{ bgcolor: 'rgba(240, 185, 11, 0.1)', color: '#F0B90B', mr: 2 }}>
                  <LocalShipping />
                </Avatar>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary', letterSpacing: '0.5px' }}>
                    {vehicle.vehicleNumber}
                  </Typography>
                  <Box sx={{ display: 'flex', columnGap: 2, rowGap: 0.25, mt: 0.5, flexWrap: 'wrap' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Person sx={{ fontSize: 14, mr: 0.5, color: 'text.secondary' }} />
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {vehicle.assignedDriverName || 'No driver assigned'}
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {vehicle.totalTrips} trips • ₹{vehicle.totalIncome.toFixed(2)}
                    </Typography>
                    {vehicle.odometer !== undefined && (
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Speed sx={{ fontSize: 14, mr: 0.5, color: 'text.secondary' }} />
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {vehicle.odometer.toLocaleString('en-IN')} km
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
                {vehicle.docsNeedingAttention > 0 && (
                  <Chip
                    icon={<WarningAmber sx={{ fontSize: 16 }} />}
                    label={`${vehicle.docsNeedingAttention} document${vehicle.docsNeedingAttention === 1 ? '' : 's'} due`}
                    size="small"
                    sx={{ mr: 2, bgcolor: 'rgba(240,185,11,0.12)', color: '#F0B90B', fontWeight: 700, '& .MuiChip-icon': { color: 'inherit' } }}
                  />
                )}
                <IconButton edge="end" aria-label="details" sx={{ color: 'text.secondary' }}>
                  <ArrowForward />
                </IconButton>
              </Box>
            ))}
          </List>
        )}
      </Paper>

      {/* Add Vehicle */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Vehicle</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              autoFocus
              required
              label="Number Plate"
              placeholder="e.g. MH12AB1234"
              fullWidth
              value={form.vehicleNumber}
              onChange={e => setForm(prev => ({ ...prev, vehicleNumber: e.target.value.toUpperCase() }))}
              error={Boolean(formError) && !form.vehicleNumber.trim()}
            />
            <TextField
              select
              label="Assigned Driver (optional)"
              fullWidth
              value={form.assignedDriverId}
              onChange={e => setForm(prev => ({ ...prev, assignedDriverId: e.target.value }))}
            >
              <MenuItem value="">No driver</MenuItem>
              {drivers.filter(d => d.active).map(d => (
                <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
              ))}
            </TextField>

            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary' }}>
                Document expiry dates (optional)
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Fill in the ones you have — you'll be reminded before each expires. You can add or change them later.
              </Typography>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
              {ADD_FORM_DOCUMENTS.map(doc => (
                <TextField
                  key={doc.key}
                  label={doc.label}
                  type="date"
                  fullWidth
                  value={form[doc.key as DocKey]}
                  onChange={e => setForm(prev => ({ ...prev, [doc.key]: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                />
              ))}
            </Box>
            {formError && <Typography variant="body2" sx={{ color: '#F6465D' }}>{formError}</Typography>}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button onClick={handleAdd} variant="contained" disabled={saving} sx={{ color: 'primary.contrastText', fontWeight: 700 }}>
            {saving ? 'Adding...' : 'Add Vehicle'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VehicleList;
