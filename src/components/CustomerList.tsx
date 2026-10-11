// CORRECTED CUSTOMER LIST COMPONENT WITH EVEN SPACING

import React, { useState } from 'react';
import {
  Box, Typography, Card, CardContent,
  IconButton, TextField, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, Chip, Avatar, List, Paper, InputAdornment, useTheme
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Person, Search, Add, Phone, AccountBalanceWallet, ArrowForward, Clear, Delete, WhatsApp, PersonSearch
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import type { Trip } from '../types';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { openWhatsApp } from '../utils/whatsapp';
import EmptyState from './EmptyState';
import { ListRowsSkeleton } from './Skeletons';
import LoadingOverlay from './LoadingOverlay';
import { useToast } from './ToastProvider';


// Type definitions
interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
}

interface CustomerStat extends Customer {
  totalTrips: number;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
}

interface NewCustomerForm {
  name: string;
  phone: string;
  address: string;
  email: string;
  gstNumber: string;
}

interface FormErrors {
  name: string;
  phone: string;
}

const CustomerList: React.FC = () => {
  // State for filtering
  const { customers, addCustomerWithCallback, getCustomerTrips, deleteCustomer, branding, isLoading } = useAppContext();
  const showSkeleton = isLoading && customers.length === 0;
  const navigate = useNavigate();
  const theme = useTheme();
  const toast = useToast();
  const [savingCustomer, setSavingCustomer] = useState(false);

  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterDate, setFilterDate] = useState<Dayjs | null>(null);
  const [filterPending, setFilterPending] = useState<boolean>(false);
  const [openAddDialog, setOpenAddDialog] = useState<boolean>(false);
  const [newCustomer, setNewCustomer] = useState<NewCustomerForm>({ name: '', phone: '', address: '', email: '', gstNumber: '' });
  const [errors, setErrors] = useState<FormErrors>({ name: '', phone: '' });
  
  // Delete confirmation state
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomerStat | null>(null);

  const getTripAmount = (trip: Trip) => Number(trip.amount || 0);

  const customerStats: CustomerStat[] = customers.map((customer: Customer) => {
    const trips = getCustomerTrips(customer.id);
    const totalTrips = trips.length;
    const totalAmount = trips.reduce((s: number, trip: Trip) => s + getTripAmount(trip), 0);
    const paidAmount = trips.filter((trip: Trip) => trip.isPaid).reduce((s: number, trip: Trip) => s + getTripAmount(trip), 0);
    const pendingAmount = totalAmount - paidAmount;
    
    return { ...customer, totalTrips, totalAmount, paidAmount, pendingAmount };
  });
 
  // Apply search filtering
  const filteredBySearch = customerStats.filter((c: CustomerStat) =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone.includes(searchTerm)
  );

  // Apply date filtering
  const filteredByDate = filterDate
    ? filteredBySearch.filter((c: CustomerStat) =>
        getCustomerTrips(c.id).some((trip: Trip) =>
          dayjs(trip.date).isSame(dayjs(filterDate), 'day')
        )
      )
    : filteredBySearch;

  // Apply pending dues filter
  const visibleStats = filterPending
    ? filteredByDate.filter((c: CustomerStat) => c.pendingAmount > 0)
    : filteredByDate;

  const totalCustomers = customers.length;
  const customersWithDues = customerStats.filter((c: CustomerStat) => c.pendingAmount > 0).length;
  const totalRevenue = customerStats.reduce((s: number, c: CustomerStat) => s + c.totalAmount, 0);
  const pendingRevenue = customerStats.reduce((s: number, c: CustomerStat) => s + c.pendingAmount, 0);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setNewCustomer(prev => ({ ...prev, [name]: value }));
    if (errors[name as keyof FormErrors]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = { name: '', phone: '' };
    let valid = true;
    
    if (!newCustomer.name.trim()) { 
      newErrors.name = 'Name is required'; 
      valid = false; 
    }
    
    if (!newCustomer.phone.trim()) {
      newErrors.phone = 'Phone number is required'; 
      valid = false;
    } else if (!/^\d{10}$/.test(newCustomer.phone.trim())) {
      newErrors.phone = 'Phone number must be 10 digits'; 
      valid = false;
    }
    
    setErrors(newErrors);
    return valid;
  };

  const handleAddCustomer = () => {
    if (!validateForm()) return;

    setSavingCustomer(true);
    addCustomerWithCallback({
      name: newCustomer.name.trim(),
      phone: newCustomer.phone.trim(),
      address: newCustomer.address.trim(),
      email: newCustomer.email.trim(),
      gstNumber: newCustomer.gstNumber.trim(),
    }, (newId: string) => {
      setSavingCustomer(false);
      setNewCustomer({ name: '', phone: '', address: '', email: '', gstNumber: '' });
      setOpenAddDialog(false);
      navigate(`/customer/${newId}`);
    }, (error) => {
      setSavingCustomer(false);
      toast.error(error instanceof Error ? error.message : 'Could not add customer. Please try again.');
    });
  };

  const handleRemind = (customer: CustomerStat, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const company = branding?.companyName || 'Transport Manager';
    const message = `Hi ${customer.name}, this is a reminder from ${company} — you have a pending balance of Rs.${customer.pendingAmount.toFixed(2)}. Please arrange payment at your earliest convenience. Thank you!`;
    openWhatsApp(customer.phone, message);
  };

  // FIXED: Proper TypeScript types for delete handler
  const handleDeleteClick = (customer: CustomerStat, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation(); // Prevent navigation when delete is clicked
    setDeleteTarget(customer);
    setConfirmOpen(true);
  };

  const handleConfirmDelete = () => {
    if (deleteTarget && deleteTarget.id) {
      deleteCustomer(deleteTarget.id);
      setConfirmOpen(false);
      setDeleteTarget(null);
    }
  };

  const handleCancelDelete = () => {
    setConfirmOpen(false);
    setDeleteTarget(null);
  };

  const handleCustomerClick = (id: string) => navigate(`/customer/${id}`);

  // FIXED: Proper DatePicker onChange handler with correct type signature
  const handleDateChange = (value: unknown) => { setFilterDate(value as Dayjs | null); };

  const clearDateFilter = () => {
    setFilterDate(null);
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setFilterDate(null);
    setFilterPending(false);
  };

  const isFiltered = searchTerm || filterDate || filterPending;

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      {/* Delete Confirmation Dialog */}
      <Dialog open={confirmOpen} onClose={handleCancelDelete} maxWidth="xs" fullWidth>
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogContent>
          Are you sure you want to delete customer "{deleteTarget?.name}"?
          {deleteTarget && deleteTarget.totalTrips > 0 && (
            <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
              Warning: This customer has {deleteTarget.totalTrips} trip(s) recorded.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelDelete}>Cancel</Button>
          <Button color="error" onClick={handleConfirmDelete} variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700, color: 'text.primary' }}>
            Customers
            {isFiltered && (
              <Box component="span" sx={{ ml: 2 }}>
                {searchTerm && (
                  <Chip 
                    label={`Search: "${searchTerm}"`} 
                    size="small" 
                    onDelete={() => setSearchTerm('')}
                    sx={{ mr: 1, fontWeight: 500, backgroundColor: 'rgba(240, 185, 11, 0.1)', color: '#F0B90B' }}
                  />
                )}
                {filterDate && (
                  <Chip 
                    label={`Date: ${dayjs(filterDate).format('MMM DD, YYYY')}`} 
                    size="small" 
                    onDelete={clearDateFilter}
                    sx={{ mr: 1, fontWeight: 500, backgroundColor: 'rgba(14, 203, 129, 0.1)', color: '#0ECB81' }}
                  />
                )}
                <Button
                  size="small"
                  onClick={clearAllFilters}
                  sx={{ minWidth: 'auto', p: 0.5, color: 'text.secondary' }}
                >
                  Clear All
                </Button>
              </Box>
            )}
          </Typography>
        </Box>

        {/* Statistics Cards with Even Spacing */}
        <Box sx={{ 
          display: 'grid', 
          gridTemplateColumns: { 
            xs: 'repeat(2, 1fr)', 
            md: 'repeat(4, 1fr)' 
          }, 
          gap: { xs: 1.5, sm: 3 }, 
          mb: 4
        }}>
          {/* Total Customers Card */}
          <Card
            onClick={() => { setFilterPending(false); setSearchTerm(''); setFilterDate(null); }}
            sx={{
              height: { xs: '124px', sm: '140px' },
              borderRadius: 2,
              background: filterPending ? theme.palette.background.paper : alpha('#F0B90B', theme.palette.mode === 'dark' ? 0.12 : 0.1),
              borderTop: `3px solid ${!filterPending && !searchTerm && !filterDate ? '#F0B90B' : theme.palette.divider}`,
              color: 'text.primary',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
              transition: 'transform 0.3s, box-shadow 0.3s',
              cursor: 'pointer',
              '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 24px rgba(240, 185, 11, 0.15)' },
              display: 'flex',
              flexDirection: 'column'
            }}>
            <CardContent sx={{ p: { xs: 1.5, sm: 2 }, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, gap: 0.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.secondary', lineHeight: 1.2, fontSize: { xs: '0.75rem', sm: '1rem' } }}>
                  Total Customers
                </Typography>
                <Avatar sx={{ bgcolor: 'rgba(240, 185, 11, 0.1)', color: '#F0B90B', width: { xs: 28, sm: 36 }, height: { xs: 28, sm: 36 }, flexShrink: 0 }}>
                  <Person sx={{ fontSize: { xs: 15, sm: 18 } }} />
                </Avatar>
              </Box>
              <Box sx={{ overflow: 'hidden' }}>
                <Typography variant="h3" sx={{ fontWeight: 800, fontSize: { xs: '1.5rem', sm: '2.2rem' }, color: 'text.primary', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {isFiltered ? visibleStats.length : totalCustomers}
                </Typography>
                {isFiltered && (
                  <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, fontSize: { xs: '0.7rem', sm: '0.875rem' } }}>
                    of {totalCustomers} total
                  </Typography>
                )}
              </Box>
            </CardContent>
          </Card>

          {/* Customers with Pending Dues Card */}
          <Card
            onClick={() => setFilterPending(prev => !prev)}
            sx={{
              height: { xs: '124px', sm: '140px' },
              borderRadius: 2,
              background: filterPending ? alpha('#F6465D', theme.palette.mode === 'dark' ? 0.14 : 0.1) : theme.palette.background.paper,
              borderTop: `3px solid #F6465D`,
              color: 'text.primary',
              boxShadow: filterPending ? '0 8px 24px rgba(246,70,93,0.3)' : '0 4px 12px rgba(0,0,0,0.2)',
              transition: 'transform 0.3s, box-shadow 0.3s',
              cursor: 'pointer',
              outline: filterPending ? '2px solid #F6465D' : 'none',
              '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 24px rgba(246, 70, 93, 0.25)' },
              display: 'flex',
              flexDirection: 'column'
            }}>
            <CardContent sx={{ p: { xs: 1.5, sm: 2 }, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, gap: 0.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.secondary', lineHeight: 1.2, fontSize: { xs: '0.75rem', sm: '1rem' } }}>
                  With Pending Dues
                </Typography>
                <Avatar sx={{ bgcolor: 'rgba(246, 70, 93, 0.1)', color: '#F6465D', width: { xs: 28, sm: 36 }, height: { xs: 28, sm: 36 }, flexShrink: 0 }}>
                  <Person sx={{ fontSize: { xs: 15, sm: 18 } }} />
                </Avatar>
              </Box>
              <Box sx={{ overflow: 'hidden' }}>
                <Typography variant="h3" sx={{ fontWeight: 800, fontSize: { xs: '1.5rem', sm: '2.2rem' }, color: '#F6465D', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {isFiltered ? visibleStats.filter((c: CustomerStat) => c.pendingAmount > 0).length : customersWithDues}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, fontSize: { xs: '0.7rem', sm: '0.875rem' } }}>
                  of {totalCustomers} customers
                </Typography>
              </Box>
            </CardContent>
          </Card>

          {/* Total Revenue Card */}
          <Card sx={{
            height: { xs: '124px', sm: '140px' },
            borderRadius: 2,
            background: theme.palette.background.paper,
            borderTop: '3px solid #0ECB81',
            color: 'text.primary',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            transition: 'transform 0.3s, box-shadow 0.3s',
            '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 24px rgba(14, 203, 129, 0.15)' },
            display: 'flex',
            flexDirection: 'column'
          }}>
            <CardContent sx={{ p: { xs: 1.5, sm: 2 }, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, gap: 0.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.secondary', lineHeight: 1.2, fontSize: { xs: '0.75rem', sm: '1rem' } }}>
                  Total Revenue
                </Typography>
                <Avatar sx={{ bgcolor: 'rgba(14, 203, 129, 0.1)', color: '#0ECB81', width: { xs: 28, sm: 36 }, height: { xs: 28, sm: 36 }, flexShrink: 0 }}>
                  <AccountBalanceWallet sx={{ fontSize: { xs: 15, sm: 18 } }} />
                </Avatar>
              </Box>
              <Box sx={{ overflow: 'hidden' }}>
                <Typography variant="h3" sx={{ fontWeight: 800, fontSize: { xs: '1.15rem', sm: '2rem' }, color: 'text.primary', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  ₹{(isFiltered ? visibleStats.reduce((s: number, c: CustomerStat) => s + c.totalAmount, 0) : totalRevenue).toFixed(2)}
                </Typography>
              </Box>
            </CardContent>
          </Card>

          {/* Pending Payments Card */}
          <Card sx={{
            height: { xs: '124px', sm: '140px' },
            borderRadius: 2,
            background: theme.palette.background.paper,
            borderTop: '3px solid #F6465D',
            color: 'text.primary',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            transition: 'transform 0.3s, box-shadow 0.3s',
            '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 8px 24px rgba(246, 70, 93, 0.15)' },
            display: 'flex',
            flexDirection: 'column'
          }}>
            <CardContent sx={{ p: { xs: 1.5, sm: 2 }, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, gap: 0.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.secondary', lineHeight: 1.2, fontSize: { xs: '0.75rem', sm: '1rem' } }}>
                  Pending Payments
                </Typography>
                <Avatar sx={{ bgcolor: 'rgba(246, 70, 93, 0.1)', color: '#F6465D', width: { xs: 28, sm: 36 }, height: { xs: 28, sm: 36 }, flexShrink: 0 }}>
                  <AccountBalanceWallet sx={{ fontSize: { xs: 15, sm: 18 } }} />
                </Avatar>
              </Box>
              <Box sx={{ overflow: 'hidden' }}>
                <Typography variant="h3" sx={{ fontWeight: 800, fontSize: { xs: '1.15rem', sm: '2rem' }, color: 'text.primary', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  ₹{(isFiltered ? visibleStats.reduce((s: number, c: CustomerStat) => s + c.pendingAmount, 0) : pendingRevenue).toFixed(2)}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Box>

        <Box sx={{ 
          display: 'flex', 
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between', 
          alignItems: { xs: 'stretch', sm: 'center' }, 
          mb: 3, 
          mt: 2, 
          gap: 2,
          p: 2,
          bgcolor: 'background.paper',
          borderRadius: 2,
          border: `1px solid ${theme.palette.divider}`
        }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', width: { xs: '100%', sm: 'auto' } }}>
            <DatePicker
              label="Filter by Trip Date"
              value={filterDate}
              onChange={handleDateChange}
              slotProps={{
                textField: { 
                  size: 'small', 
                  sx: { 
                    width: 200,
                  }
                }
              }}
            />

            <TextField
              placeholder="Search customers..."
              variant="outlined"
              size="small"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              sx={{ 
                width: { xs: '100%', sm: '300px' },
              }}
              InputProps={{ 
                startAdornment: (
                  <InputAdornment position="start">
                    <Search sx={{ color: 'text.secondary' }} />
                  </InputAdornment>
                ),
                endAdornment: searchTerm && (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="clear search"
                      onClick={() => setSearchTerm('')}
                      edge="end"
                      size="small"
                      sx={{ color: 'text.secondary' }}
                    >
                      <Clear fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                )
              }}
            />
          </Box>

          <Button 
            variant="contained" 
            color="primary" 
            startIcon={<Add />} 
            onClick={() => setOpenAddDialog(true)}
          >
            Add Customer
          </Button>
        </Box>

        {/* Add Customer Dialog */}
        <Dialog
          open={openAddDialog}
          onClose={() => !savingCustomer && setOpenAddDialog(false)}
          maxWidth="sm"
          fullWidth
          PaperProps={{ sx: { position: 'relative', overflow: 'hidden' } }}
        >
          <LoadingOverlay open={savingCustomer} absolute label="Adding customer…" />
          <DialogTitle>Add New Customer</DialogTitle>
          <DialogContent>
            <Box sx={{ pt: 1 }}>
              <TextField 
                autoFocus 
                name="name" 
                label="Customer Name" 
                fullWidth 
                variant="outlined" 
                value={newCustomer.name} 
                onChange={handleInputChange} 
                error={!!errors.name} 
                helperText={errors.name} 
                sx={{ mb: 2 }} 
              />
              <TextField 
                name="phone" 
                label="Phone Number" 
                fullWidth 
                variant="outlined" 
                value={newCustomer.phone} 
                onChange={handleInputChange} 
                error={!!errors.phone} 
                helperText={errors.phone} 
                sx={{ mb: 2 }} 
              />
              <TextField
                name="address"
                label="Address (Optional)"
                fullWidth
                variant="outlined"
                value={newCustomer.address}
                onChange={handleInputChange}
                multiline
                rows={2}
                sx={{ mb: 2 }}
              />
              <TextField
                name="email"
                label="Email (Optional — for emailing bills)"
                fullWidth
                variant="outlined"
                value={newCustomer.email}
                onChange={handleInputChange}
                sx={{ mb: 2 }}
              />
              <TextField
                name="gstNumber"
                label="GST Number (Optional)"
                fullWidth
                variant="outlined"
                value={newCustomer.gstNumber}
                onChange={handleInputChange}
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenAddDialog(false)} disabled={savingCustomer}>Cancel</Button>
            <Button onClick={handleAddCustomer} variant="contained" color="primary" disabled={savingCustomer}>Add Customer</Button>
          </DialogActions>
        </Dialog>

        {/* Customer List */}
        <Paper elevation={0} sx={{ p: 3, mt: 3, borderRadius: 2, background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}` }}>
          <Typography 
            variant="h6" 
            gutterBottom 
            sx={{ 
              fontWeight: 600, 
              mb: 2, 
              color: 'text.primary' 
            }}
          >
            {isFiltered ? 'Filtered Results' : 'All Customers'} 
            <Typography component="span" variant="body2" sx={{ ml: 1, color: 'text.secondary' }}>
              ({visibleStats.length} {visibleStats.length === 1 ? 'customer' : 'customers'})
            </Typography>
          </Typography>

          {showSkeleton ? (
            <ListRowsSkeleton />
          ) : visibleStats.length === 0 ? (
            isFiltered ? (
              <EmptyState
                icon={<PersonSearch />}
                title="No customers match your filters"
                description="Try adjusting your search term or date filter."
                action={{ label: 'Clear all filters', onClick: clearAllFilters }}
              />
            ) : (
              <EmptyState
                icon={<Person />}
                title="No customers added yet"
                description="Add your first customer to start tracking their trips and payments."
                action={{ label: 'Add Customer', onClick: () => setOpenAddDialog(true), icon: <Add /> }}
              />
            )
          ) : (
            <List sx={{ p: 0 }}>
              {visibleStats.map((customer: CustomerStat, index: number) => (
                <Box 
                  key={customer.id} 
                  onClick={() => handleCustomerClick(customer.id)}
                  sx={{ 
                    mb: 1.5, 
                    p: 2, 
                    borderRadius: 2, 
                    backgroundColor: index % 2 === 0 ? 'action.hover' : 'background.paper',
                    border: `1px solid ${theme.palette.divider}`,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: { xs: 'flex-start', sm: 'center' },
                    flexDirection: { xs: 'column', sm: 'row' },
                    transition: 'all 0.2s ease-in-out',
                    '&:hover': { 
                      backgroundColor: 'divider',
                      borderLeft: '4px solid #F0B90B'
                    }
                  }}
                >
                  <Avatar sx={{ bgcolor: 'rgba(240, 185, 11, 0.1)', color: '#F0B90B', mr: 2 }}>
                    <Person />
                  </Avatar>
                  <Box sx={{ flexGrow: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.primary' }}>
                      {customer.name}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Phone sx={{ fontSize: 14, mr: 0.5, color: 'text.secondary' }} />
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {customer.phone}
                        </Typography>
                      </Box>
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {customer.totalTrips} trips • ₹{customer.totalAmount.toFixed(2)}
                      </Typography>
                    </Box>
                  </Box>
                  
                  {/* Pending Amount Display */}
                  {customer.pendingAmount > 0 && (
                    <Box sx={{ 
                      bgcolor: 'rgba(246, 70, 93, 0.1)', 
                      px: 1.5, 
                      py: 0.5, 
                      borderRadius: 1.5, 
                      display: 'flex', 
                      alignItems: 'center', 
                      mr: 2 
                    }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#F6465D' }}>
                        ₹{customer.pendingAmount.toFixed(2)}
                      </Typography>
                      <Typography variant="body2" sx={{ ml: 1, fontWeight: 500, color: '#F6465D', fontSize: '0.75rem' }}>
                        pending
                      </Typography>
                    </Box>
                  )}

                  {/* Action Buttons */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {customer.pendingAmount > 0 && customer.phone && (
                      <IconButton
                        edge="end"
                        aria-label="remind via whatsapp"
                        onClick={(e) => handleRemind(customer, e)}
                        sx={{ color: '#25D366', '&:hover': { bgcolor: 'rgba(37, 211, 102, 0.1)' } }}
                      >
                        <WhatsApp />
                      </IconButton>
                    )}
                    <IconButton
                      edge="end"
                      aria-label="delete"
                      onClick={(e) => handleDeleteClick(customer, e)}
                      sx={{ 
                        color: 'text.secondary',
                        '&:hover': { 
                          color: '#F6465D'
                        }
                      }}
                    >
                      <Delete />
                    </IconButton>
                    <IconButton edge="end" aria-label="details" sx={{ color: 'text.secondary' }}>
                      <ArrowForward />
                    </IconButton>
                  </Box>
                </Box>
              ))}
            </List>
          )}
        </Paper>
      </Box>
    </LocalizationProvider>
  );
};

export default CustomerList;
