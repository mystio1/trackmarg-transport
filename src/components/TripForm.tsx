import React, { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  GridLegacy as Grid,
  InputAdornment,
  Checkbox,
  FormControlLabel,
  Paper,
  Divider,
  Autocomplete,
  useTheme,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { useAppContext } from '../context/AppContext';
import type { Trip } from '../types';
import { useToast } from './ToastProvider';
import LoadingOverlay from './LoadingOverlay';

interface TripFormProps {
  customerId: string;
  onTripAdded?: () => void;
}

interface DriverOption {
  id: string;
  label: string;
}

const SELF_DRIVER_OPTION: DriverOption = { id: 'self', label: 'Self (Admin)' };

const TripForm: React.FC<TripFormProps> = ({ customerId, onTripAdded }) => {
  const { addTrip, customers, drivers, vehicles } = useAppContext();
  const theme = useTheme();
  const toast = useToast();
  const customer = customers.find(c => c.id === customerId);

  // Every admin-created trip must be explicitly attributed to a driver or to the admin
  // themself — no default selection, so it's never silently misattributed.
  const driverOptions = useMemo<DriverOption[]>(
    () => [
      SELF_DRIVER_OPTION,
      ...drivers
        .filter(d => d.active)
        .map(d => ({ id: d.id, label: `${d.name}${d.userCode ? ` (${d.userCode})` : ''}` })),
    ],
    [drivers],
  );
  const [selectedDriver, setSelectedDriver] = useState<DriverOption | null>(null);

  const [tripData, setTripData] = useState<Omit<Trip, 'id'>>({
    customerId,
    date: new Date().toISOString(),
    pickupLocation: '',
    dropLocation: '',
    vehicleType: '',
    vehicleNumber: '',
    materialType: '',
    advanceAmount: 0,
    amount: 0,
    isPaid: false,
  });

  const [errors, setErrors] = useState({
    pickupLocation: '',
    dropLocation: '',
    vehicleType: '',
    advanceAmount: '',
    amount: '',
    driver: '',
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    if (name === 'amount' || name === 'advanceAmount') {
      const numValue = value === '' ? 0 : parseFloat(value);
      setTripData(prev => ({
        ...prev,
        [name]: numValue,
      }));
    } else {
      setTripData(prev => ({
        ...prev,
        [name]: value,
      }));
    }

    if (errors[name as keyof typeof errors]) {
      setErrors(prev => ({
        ...prev,
        [name]: '',
      }));
    }
  };

  const handleDateChange = (value: unknown) => { const date = value as Date | null;
    if (date) {
      setTripData(prev => ({
        ...prev,
        date: date.toISOString(),
      }));
    } else {
      setTripData(prev => ({
        ...prev,
        date: new Date().toISOString(),
      }));
    }
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTripData(prev => ({
      ...prev,
      isPaid: e.target.checked,
    }));
  };

  const validateForm = () => {
    let valid = true;
    const newErrors = {
      pickupLocation: '',
      dropLocation: '',
      vehicleType: '',
      advanceAmount: '',
      amount: '',
      driver: '',
    };

    if (!selectedDriver) {
      newErrors.driver = 'Select a driver, or Self';
      valid = false;
    }

    if (!tripData.pickupLocation.trim()) {
      newErrors.pickupLocation = 'Pickup location is required';
      valid = false;
    }

    if (!tripData.dropLocation.trim()) {
      newErrors.dropLocation = 'Drop location is required';
      valid = false;
    }

    if (!tripData.vehicleType.trim()) {
      newErrors.vehicleType = 'Vehicle type is required';
      valid = false;
    }

    if (tripData.amount <= 0) {
      newErrors.amount = 'Amount must be greater than zero';
      valid = false;
    }

    if ((tripData.advanceAmount ?? 0) < 0) {
      newErrors.advanceAmount = 'Advance amount cannot be negative';
      valid = false;
    }

    setErrors(newErrors);
    return valid;
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm() || !selectedDriver) return;

    setIsSubmitting(true);
    try {
      await addTrip({ ...tripData, driverId: selectedDriver.id });
      toast.success('Trip added.');

      setTripData({
        customerId,
        date: new Date().toISOString(),
        pickupLocation: '',
        dropLocation: '',
        vehicleType: '',
        vehicleNumber: '',
        materialType: '',
        amount: 0,
        isPaid: false,
      });
      setSelectedDriver(null);

      // Notify parent component
      if (onTripAdded) {
        onTripAdded();
      }
    } catch (error) {
      // Previously silently logged to the console only — the admin had no way to know the trip
      // wasn't actually saved.
      toast.error(error instanceof Error ? error.message : 'Could not add trip. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Paper elevation={0} sx={{ p: { xs: 2, sm: 4 }, mb: 4, borderRadius: 2, background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, position: 'relative', overflow: 'hidden' }}>
      <LoadingOverlay open={isSubmitting} absolute label="Adding trip…" />
      <Typography variant="h5" gutterBottom sx={{ fontWeight: 700, mb: 2, color: 'text.primary' }}>
        Add New Trip for <span style={{ color: '#F0B90B' }}>{customer?.name}</span>
      </Typography>
      <Divider sx={{ mb: 3, borderColor: 'divider' }} />
      <form onSubmit={handleSubmit}>
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6}>
            <Autocomplete
              options={driverOptions}
              getOptionLabel={option => option.label}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              value={selectedDriver}
              onChange={(_, value) => {
                setSelectedDriver(value);
                if (value) setErrors(prev => ({ ...prev, driver: '' }));
              }}
              renderInput={params => (
                <TextField
                  {...params}
                  label="Driver"
                  placeholder="Select a driver, or Self"
                  error={!!errors.driver}
                  helperText={errors.driver}
                />
              )}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <LocalizationProvider dateAdapter={AdapterDateFns}>
              <DatePicker
                label="Trip Date"
                value={new Date(tripData.date)}
                onChange={handleDateChange}
                slotProps={{
                  textField: {
                    fullWidth: true,
                    variant: 'outlined',
                    sx: {
                      '& .MuiInputBase-input': { color: 'text.primary' },
                      '& .MuiInputLabel-root': { color: 'text.secondary' },
                      '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
                      '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#F0B90B' },
                      '& .MuiSvgIcon-root': { color: 'text.secondary' },
                    },
                  },
                }}
              />
            </LocalizationProvider>
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Vehicle Type"
              name="vehicleType"
              value={tripData.vehicleType}
              onChange={handleInputChange}
              variant="outlined"
              error={!!errors.vehicleType}
              helperText={errors.vehicleType}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <Autocomplete
              freeSolo
              options={vehicles.map(v => v.vehicleNumber)}
              inputValue={tripData.vehicleNumber || ''}
              onInputChange={(_e, value) => setTripData(prev => ({ ...prev, vehicleNumber: value.toUpperCase() }))}
              renderInput={params => (
                <TextField {...params} fullWidth label="Vehicle Number" name="vehicleNumber" placeholder="e.g. MH12AB1234" variant="outlined" />
              )}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Pickup Location"
              name="pickupLocation"
              value={tripData.pickupLocation}
              onChange={handleInputChange}
              variant="outlined"
              error={!!errors.pickupLocation}
              helperText={errors.pickupLocation}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Drop Location"
              name="dropLocation"
              value={tripData.dropLocation}
              onChange={handleInputChange}
              variant="outlined"
              error={!!errors.dropLocation}
              helperText={errors.dropLocation}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Material Type"
              name="materialType"
              value={tripData.materialType || ''}
              onChange={handleInputChange}
              variant="outlined"
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Amount"
              name="amount"
              type="number"
              value={tripData.amount === 0 ? '' : tripData.amount}
              onChange={handleInputChange}
              variant="outlined"
              error={!!errors.amount}
              helperText={errors.amount || 'Enter the trip amount'}
              InputProps={{
                startAdornment: <InputAdornment position="start">₹</InputAdornment>,
              }}
              placeholder="Enter amount"
              autoFocus
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Advance Amount"
              name="advanceAmount"
              type="number"
              value={tripData.advanceAmount === 0 ? '' : tripData.advanceAmount}
              onChange={handleInputChange}
              variant="outlined"
              error={!!errors.advanceAmount}
              helperText={errors.advanceAmount || 'Enter advance amount if any'}
              InputProps={{
                startAdornment: <InputAdornment position="start">₹</InputAdornment>,
              }}
              placeholder="Enter advance"
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <Box sx={{ height: '100%', display: 'flex', alignItems: 'center' }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={tripData.isPaid}
                    onChange={handleCheckboxChange}
                    sx={{
                      color: 'text.secondary',
                      '&.Mui-checked': {
                        color: '#0ECB81',
                        '& .MuiSvgIcon-root': { fontSize: 24 }
                      },
                      '&:hover': { bgcolor: 'rgba(14, 203, 129, 0.08)' }
                    }}
                  />
                }
                label={<Typography sx={{ fontWeight: 600, color: tripData.isPaid ? '#0ECB81' : 'text.secondary' }}>Payment Received</Typography>}
              />
            </Box>
          </Grid>

          <Grid item xs={12}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
              <Button
                type="submit"
                variant="contained"
                color="primary"
                size="large"
                disabled={isSubmitting}
                sx={{
                  fontWeight: 600,
                  padding: '10px 32px',
                  borderRadius: 2,
                  color: 'primary.contrastText',
                  background: '#F0B90B',
                  boxShadow: 'none',
                  '&:hover': {
                    background: '#FCD535',
                    boxShadow: 'none',
                    transform: 'translateY(-1px)'
                  },
                  transition: 'all 0.2s ease-in-out'
                }}
              >
                Add Trip
              </Button>
            </Box>
          </Grid>
        </Grid>
      </form>
    </Paper>
  );
};

export default TripForm;
