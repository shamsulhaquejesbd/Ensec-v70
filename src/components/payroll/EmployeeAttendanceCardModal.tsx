/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Ensec ERP - Printable Monthly Employee Attendance Card
 * Reconstructs the classic physical attendance card digitally with live Supabase
 * integration across field_force_reps, employee_attendances, and overtime_requests.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  X,
  Printer,
  RefreshCw,
  Calendar,
  UserCheck,
  AlertCircle,
  Clock,
  FileText,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext.tsx';
import { getSupabase } from '../../lib/supabase.ts';
import { parseTimeToMinutes } from '../../lib/geofence.ts';
import type { FieldForceRep } from '../../types/erp.ts';
import type { AttendanceRecord, AttendanceStatus } from '../../types/payroll.ts';
import type { OvertimeAttendance, OvertimeRequest } from '../../types/overtime.ts';

interface EmployeeAttendanceCardModalProps {
  isOpen: boolean;
  initialEmployeeId?: string;
  initialMonthYear?: string; // YYYY-MM
  onClose: () => void;
}

interface DayCardRow {
  day: number;
  dateIso: string;
  weekdayShort: string;
  isWeekendFriday: boolean;
  checkInTime: string;
  checkOutTime: string;
  regularWorkingHours: number | null;
  attendanceStatus: AttendanceStatus | '';
  otExpectedStart: string;
  otExpectedEnd: string;
  otHours: number | null;
  otStatus: string;
  otRequestCount: number;
  netLunchAdjustedHours: number | null;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatHoursToHMM(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours) || hours <= 0) return '—';
  const totalMins = Math.round(hours * 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function normalizeTimeDisplay(raw?: string): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return trimmed;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function sanitizeOrValue(val: string): string {
  return val.replace(/[,()]/g, '').trim();
}

export const EmployeeAttendanceCardModal: React.FC<EmployeeAttendanceCardModalProps> = ({
  isOpen,
  initialEmployeeId,
  initialMonthYear,
  onClose,
}) => {
  const {
    fieldForceReps,
    attendanceRecords,
    overtimeRequests,
    overtimeAttendances,
    payrollSettings,
    systemSettings,
  } = useERP();

  const defaultMonthYear = initialMonthYear || new Date().toISOString().slice(0, 7);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(
    initialEmployeeId || fieldForceReps[0]?.id || ''
  );
  const [selectedMonthYear, setSelectedMonthYear] = useState<string>(defaultMonthYear);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dbEmployee, setDbEmployee] = useState<FieldForceRep | null>(null);
  const [dbAttendances, setDbAttendances] = useState<AttendanceRecord[]>([]);
  const [dbOvertimeRequests, setDbOvertimeRequests] = useState<OvertimeRequest[]>([]);
  const [dbOvertimeAttendances, setDbOvertimeAttendances] = useState<OvertimeAttendance[]>([]);

  // Sync initial props whenever modal opens
  useEffect(() => {
    if (!isOpen) return;
    if (initialEmployeeId) {
      setSelectedEmployeeId(initialEmployeeId);
    } else if (!selectedEmployeeId && fieldForceReps.length > 0) {
      setSelectedEmployeeId(fieldForceReps[0].id);
    }
    if (initialMonthYear) {
      setSelectedMonthYear(initialMonthYear);
    }
  }, [isOpen, initialEmployeeId, initialMonthYear]);

  const contextEmployee = useMemo(
    () =>
      fieldForceReps.find(
        (e) => e.id === selectedEmployeeId || e.code === selectedEmployeeId
      ) || fieldForceReps[0],
    [fieldForceReps, selectedEmployeeId]
  );

  const activeEmployee = dbEmployee || contextEmployee;

  const { yearNum, monthNum, monthStart, monthEnd, daysInMonth, monthLabel } = useMemo(() => {
    const parts = (selectedMonthYear || new Date().toISOString().slice(0, 7)).split('-');
    const y = Math.max(2000, Math.min(2100, Number(parts[0]) || new Date().getFullYear()));
    const m = Math.max(1, Math.min(12, Number(parts[1]) || new Date().getMonth() + 1));
    const dim = new Date(y, m, 0).getDate();
    const mm = String(m).padStart(2, '0');
    return {
      yearNum: y,
      monthNum: m,
      monthStart: `${y}-${mm}-01`,
      monthEnd: `${y}-${mm}-${String(dim).padStart(2, '0')}`,
      daysInMonth: dim,
      monthLabel: `${MONTH_NAMES[m - 1]} ${y}`,
    };
  }, [selectedMonthYear]);

  const fetchCardData = useCallback(async () => {
    if (!isOpen || !contextEmployee) return;
    const sb = getSupabase();
    if (!sb) {
      setDbEmployee(null);
      setDbAttendances([]);
      setDbOvertimeRequests([]);
      setDbOvertimeAttendances([]);
      setLoadError(null);
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    const empIdStr = sanitizeOrValue(String(contextEmployee.id || ''));
    const empCodeStr = sanitizeOrValue(String(contextEmployee.code || ''));
    const empFilter =
      empIdStr && empCodeStr
        ? `employee_id.eq.${empIdStr},employee_code.eq.${empCodeStr}`
        : empIdStr
        ? `employee_id.eq.${empIdStr}`
        : `employee_code.eq.${empCodeStr}`;

    try {
      const empIdNum = Number(empIdStr);
      const repQuery = Number.isFinite(empIdNum) && empIdStr !== ''
        ? sb.from('field_force_reps').select('*').eq('id', empIdNum).maybeSingle()
        : sb.from('field_force_reps').select('*').eq('code', empCodeStr).maybeSingle();

      const [repRes, attRes, otReqRes, otAttRes, backupAttRes] = await Promise.all([
        repQuery,
        sb
          .from('employee_attendances')
          .select('*')
          .or(empFilter)
          .gte('date', monthStart)
          .lte('date', monthEnd)
          .order('date', { ascending: true }),
        sb
          .from('overtime_requests')
          .select('*')
          .or(empFilter)
          .gte('overtime_date', monthStart)
          .lte('overtime_date', monthEnd)
          .order('overtime_date', { ascending: true }),
        sb
          .from('overtime_attendances')
          .select('*')
          .or(empFilter)
          .gte('date', monthStart)
          .lte('date', monthEnd)
          .order('date', { ascending: true }),
        sb
          .from('system_settings')
          .select('settings_json')
          .eq('id', 'employee_attendances')
          .maybeSingle(),
      ]);

      if (!repRes.error && repRes.data) {
        const row: any = repRes.data;
        setDbEmployee({
          ...contextEmployee,
          id: String(row.id),
          code: row.code || contextEmployee.code,
          name: row.name || contextEmployee.name,
          nativeName: row.native_name || contextEmployee.nativeName,
          designation: row.designation || contextEmployee.designation,
          fieldForceType: row.field_force_type || contextEmployee.fieldForceType,
          department: row.department || contextEmployee.department,
          employeeCategory: row.employee_category || contextEmployee.employeeCategory,
          employmentType: row.employment_type || contextEmployee.employmentType,
          employmentStatus: row.employment_status || contextEmployee.employmentStatus,
          assignedOfficeId: row.assigned_office_id || contextEmployee.assignedOfficeId,
          assignedOfficeName: row.assigned_office_name || contextEmployee.assignedOfficeName,
          branchWorkplace: row.branch_workplace || contextEmployee.branchWorkplace,
          shiftStartTime: row.shift_start_time || contextEmployee.shiftStartTime,
          shiftEndTime: row.shift_end_time || contextEmployee.shiftEndTime,
          joiningDate: row.joining_date || contextEmployee.joiningDate,
        });
      } else {
        setDbEmployee(null);
      }

      const mappedAtts: AttendanceRecord[] =
        !attRes.error && Array.isArray(attRes.data)
          ? attRes.data.map((row: any) => ({
              id: String(row.id),
              fieldForceId: row.employee_id ? String(row.employee_id) : undefined,
              employeeId: row.employee_id ? String(row.employee_id) : undefined,
              employeeCode: row.employee_code || undefined,
              employeeName: row.employee_name || contextEmployee.name,
              department: row.department || undefined,
              designation: row.designation || undefined,
              date: String(row.date).slice(0, 10),
              status: (row.status || 'Present') as AttendanceStatus,
              inTime: row.in_time || undefined,
              checkInTime: row.in_time || undefined,
              outTime: row.out_time || undefined,
              checkOutTime: row.out_time || undefined,
              workHours:
                row.work_hours !== null && row.work_hours !== undefined
                  ? Number(row.work_hours)
                  : undefined,
              overtimeHours: Number(row.overtime_hours) || 0,
              lateDurationMinutes: Number(row.late_duration_minutes) || 0,
              lateMinutes: Number(row.late_duration_minutes) || 0,
              isLate: (Number(row.late_duration_minutes) || 0) > 0 || row.status === 'Late',
              assignedOfficeId: row.assigned_office_id || undefined,
              assignedOfficeName: row.assigned_office_name || undefined,
              gpsValidationStatus: row.gps_validation_status || 'Manual',
              remarks: row.remarks || undefined,
              updatedAt: row.updated_at || row.created_at,
            }))
          : [];

      // Merge system_settings backup if employee_attendances had pending rows
      const backupList: AttendanceRecord[] =
        !backupAttRes.error &&
        backupAttRes.data?.settings_json &&
        typeof backupAttRes.data.settings_json === 'object' &&
        Array.isArray((backupAttRes.data.settings_json as any).records)
          ? ((backupAttRes.data.settings_json as any).records as AttendanceRecord[]).filter(
              (r) =>
                r.date >= monthStart &&
                r.date <= monthEnd &&
                (r.employeeId === empIdStr ||
                  r.fieldForceId === empIdStr ||
                  (empCodeStr && r.employeeCode === empCodeStr))
            )
          : [];

      const attMergedMap = new Map<string, AttendanceRecord>();
      mappedAtts.forEach((r) => attMergedMap.set(r.date, r));
      backupList.forEach((b) => {
        const existing = attMergedMap.get(b.date);
        if (!existing) {
          attMergedMap.set(b.date, b);
        } else {
          const eTime = existing.updatedAt ? Date.parse(existing.updatedAt) : 0;
          const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
          if (bTime > eTime) attMergedMap.set(b.date, b);
        }
      });
      setDbAttendances(Array.from(attMergedMap.values()));

      if (!otReqRes.error && Array.isArray(otReqRes.data)) {
        const mappedReqs: OvertimeRequest[] = otReqRes.data.map((r: any) => ({
          id: String(r.id),
          requestNumber: r.request_number || '',
          employeeId: String(r.employee_id),
          employeeCode: r.employee_code || '',
          employeeName: r.employee_name || contextEmployee.name,
          department: r.department || '',
          designation: r.designation || '',
          employeeCategory: r.employee_category || undefined,
          overtimeDate: String(r.overtime_date).slice(0, 10),
          purposeCategory: r.purpose_category || 'Direct Production',
          productionOrderId: r.production_order_id || undefined,
          productionOrderNumber: r.production_order_number || undefined,
          productionBatchNumber: r.production_batch_number || undefined,
          productName: r.product_name || undefined,
          projectPurpose: r.project_purpose || '',
          expectedStartTime: r.expected_start_time || '',
          expectedEndTime: r.expected_end_time || '',
          expectedHours: Number(r.expected_hours) || 0,
          overtimeReason: r.overtime_reason || '',
          requestedBy: r.requested_by || '',
          requestedAt: r.requested_at || r.created_at || '',
          status: r.status || 'Pending Supervisor',
          actualOvertimeHours:
            r.actual_overtime_hours !== null && r.actual_overtime_hours !== undefined
              ? Number(r.actual_overtime_hours)
              : undefined,
          basicSalaryBDT: Number(r.basic_salary_bdt) || 0,
          hourlyRateBDT: Number(r.hourly_rate_bdt) || 0,
          overtimeMultiplier: Number(r.overtime_multiplier) || 1,
          calculatedOvertimeAmountBDT: Number(r.calculated_overtime_amount_bdt) || 0,
          batchAllocations: [],
          createdAt: r.created_at || '',
          updatedAt: r.updated_at || undefined,
        }));
        setDbOvertimeRequests(mappedReqs);
      } else {
        setDbOvertimeRequests([]);
      }

      if (!otAttRes.error && Array.isArray(otAttRes.data)) {
        const mappedOtAtts: OvertimeAttendance[] = otAttRes.data.map((a: any) => ({
          id: String(a.id),
          requestId: a.request_id || undefined,
          requestNumber: a.request_number || undefined,
          employeeId: String(a.employee_id),
          employeeCode: a.employee_code || '',
          employeeName: a.employee_name || '',
          department: a.department || '',
          designation: a.designation || '',
          date: String(a.date).slice(0, 10),
          normalCheckInTime: a.normal_check_in_time || '09:00',
          normalCheckOutTime: a.normal_check_out_time || '18:00',
          overtimeCheckInTime: a.overtime_check_in_time || '',
          overtimeCheckOutTime: a.overtime_check_out_time || '',
          isOvernight: Boolean(a.is_overnight),
          breakDurationMinutes: Number(a.break_duration_minutes) || 0,
          rawCalculatedHours: Number(a.raw_calculated_hours) || 0,
          actualOvertimeHours: Number(a.actual_overtime_hours) || 0,
          isVerified: Boolean(a.is_verified),
          syncSource: (a.sync_source || 'Manual') as any,
          createdAt: a.created_at || '',
        }));
        setDbOvertimeAttendances(mappedOtAtts);
      } else {
        setDbOvertimeAttendances([]);
      }

      const firstErr = attRes.error || otReqRes.error;
      if (firstErr) {
        setLoadError(firstErr.message || 'Partial error loading attendance or overtime records from Supabase.');
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Unable to load monthly attendance card data from Supabase.');
    } finally {
      setIsLoading(false);
    }
  }, [isOpen, contextEmployee, monthStart, monthEnd]);

  useEffect(() => {
    fetchCardData();
  }, [fetchCardData]);

  // Merge direct Supabase query results with live ERPContext records strictly bounded to selected employee + month
  const monthlyAttendancesByDate = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    if (!activeEmployee) return map;
    const empId = String(activeEmployee.id);
    const empCode = activeEmployee.code || '';

    const isForEmployeeAndMonth = (r: AttendanceRecord) =>
      r.date >= monthStart &&
      r.date <= monthEnd &&
      (r.employeeId === empId ||
        r.fieldForceId === empId ||
        (empCode && r.employeeCode === empCode));

    attendanceRecords.filter(isForEmployeeAndMonth).forEach((r) => map.set(r.date, r));
    dbAttendances.filter(isForEmployeeAndMonth).forEach((r) => {
      const prev = map.get(r.date);
      if (!prev) {
        map.set(r.date, r);
      } else {
        const pTime = prev.updatedAt ? Date.parse(prev.updatedAt) : 0;
        const nTime = r.updatedAt ? Date.parse(r.updatedAt) : 0;
        if (nTime >= pTime) map.set(r.date, r);
      }
    });
    return map;
  }, [activeEmployee, attendanceRecords, dbAttendances, monthStart, monthEnd]);

  const monthlyOvertimeRequests = useMemo(() => {
    if (!activeEmployee) return [];
    const empId = String(activeEmployee.id);
    const empCode = activeEmployee.code || '';

    const isForEmployeeAndMonth = (r: OvertimeRequest) =>
      r.overtimeDate >= monthStart &&
      r.overtimeDate <= monthEnd &&
      (r.employeeId === empId || (empCode && r.employeeCode === empCode));

    const map = new Map<string, OvertimeRequest>();
    overtimeRequests.filter(isForEmployeeAndMonth).forEach((r) => map.set(r.id, r));
    dbOvertimeRequests.filter(isForEmployeeAndMonth).forEach((r) => map.set(r.id, r));

    return Array.from(map.values()).sort((a, b) => a.overtimeDate.localeCompare(b.overtimeDate));
  }, [activeEmployee, overtimeRequests, dbOvertimeRequests, monthStart, monthEnd]);

  const monthlyOvertimeAttendancesByDate = useMemo(() => {
    const map = new Map<string, OvertimeAttendance[]>();
    if (!activeEmployee) return map;
    const empId = String(activeEmployee.id);
    const empCode = activeEmployee.code || '';

    const isForEmployeeAndMonth = (a: OvertimeAttendance) =>
      a.date >= monthStart &&
      a.date <= monthEnd &&
      (a.employeeId === empId || (empCode && a.employeeCode === empCode));

    const dedup = new Map<string, OvertimeAttendance>();
    overtimeAttendances.filter(isForEmployeeAndMonth).forEach((a) => dedup.set(a.id, a));
    dbOvertimeAttendances.filter(isForEmployeeAndMonth).forEach((a) => dedup.set(a.id, a));

    dedup.forEach((a) => {
      const list = map.get(a.date) || [];
      list.push(a);
      map.set(a.date, list);
    });
    return map;
  }, [activeEmployee, overtimeAttendances, dbOvertimeAttendances, monthStart, monthEnd]);

  // Build dynamic day rows (1..daysInMonth — handles 28, 29, 30, 31 automatically)
  const dayRows: DayCardRow[] = useMemo(() => {
    const mm = String(monthNum).padStart(2, '0');
    const rows: DayCardRow[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dd = String(day).padStart(2, '0');
      const dateIso = `${yearNum}-${mm}-${dd}`;
      const weekdayIdx = new Date(yearNum, monthNum - 1, day).getDay();
      const att = monthlyAttendancesByDate.get(dateIso);
      const dayOtReqs = monthlyOvertimeRequests.filter((r) => r.overtimeDate === dateIso);
      const dayOtAtts = monthlyOvertimeAttendancesByDate.get(dateIso) || [];

      const checkInTime = normalizeTimeDisplay(att?.checkInTime || att?.inTime);
      const checkOutTime = normalizeTimeDisplay(att?.checkOutTime || att?.outTime);

      // Compute regular hours from stored workHours or checkIn/checkOut span
      let regularWorkingHours: number | null = null;
      let rawShiftSpanHours = 0;
      if (checkInTime && checkOutTime) {
        const inM = parseTimeToMinutes(checkInTime);
        const outM = parseTimeToMinutes(checkOutTime);
        if (inM !== null && outM !== null) {
          const diff = outM >= inM ? outM - inM : outM + 1440 - inM;
          rawShiftSpanHours = Math.round((diff / 60) * 100) / 100;
        }
      }
      if (att && typeof att.workHours === 'number' && att.workHours > 0) {
        regularWorkingHours = Math.round(att.workHours * 100) / 100;
      } else if (rawShiftSpanHours > 0) {
        regularWorkingHours = rawShiftSpanHours;
      }

      // Overtime aggregation for this date from overtime_requests (+ attendance fallback)
      const activeOtReqs = dayOtReqs.filter(
        (r) => r.status !== 'Rejected' && r.status !== 'Cancelled'
      );
      const primaryOt = activeOtReqs[0] || dayOtReqs[0];
      const otExpectedStart = normalizeTimeDisplay(primaryOt?.expectedStartTime);
      const otExpectedEnd = normalizeTimeDisplay(primaryOt?.expectedEndTime);

      let otHours: number | null = null;
      if (activeOtReqs.length > 0) {
        const sumReqOt = activeOtReqs.reduce((sum, req) => {
          const matchedAtt = dayOtAtts.find((a) => a.requestId === req.id);
          const actual =
            matchedAtt && matchedAtt.actualOvertimeHours > 0
              ? matchedAtt.actualOvertimeHours
              : req.actualOvertimeHours && req.actualOvertimeHours > 0
              ? req.actualOvertimeHours
              : req.expectedHours;
          return sum + (Number(actual) || 0);
        }, 0);
        otHours = Math.round(sumReqOt * 100) / 100;
      } else if (dayOtAtts.length > 0) {
        const sumAttOt = dayOtAtts.reduce(
          (sum, a) => sum + (Number(a.actualOvertimeHours) || 0),
          0
        );
        otHours = sumAttOt > 0 ? Math.round(sumAttOt * 100) / 100 : null;
      } else if (att && typeof att.overtimeHours === 'number' && att.overtimeHours > 0) {
        otHours = Math.round(att.overtimeHours * 100) / 100;
      }

      // Physical card lunch rule: Working hour + Overtime hour - 1 hr lunch (when shift span >= 5h)
      let netLunchAdjustedHours: number | null = null;
      const baseReg = rawShiftSpanHours > 0 ? rawShiftSpanHours : regularWorkingHours || 0;
      if (baseReg > 0) {
        const lunchDeduct = baseReg >= 5 ? 1 : 0;
        netLunchAdjustedHours = Math.max(
          0,
          Math.round((baseReg + (otHours || 0) - lunchDeduct) * 100) / 100
        );
      } else if (otHours && otHours > 0) {
        netLunchAdjustedHours = otHours;
      }

      rows.push({
        day,
        dateIso,
        weekdayShort: WEEKDAY_SHORT[weekdayIdx],
        isWeekendFriday: weekdayIdx === 5,
        checkInTime,
        checkOutTime,
        regularWorkingHours,
        attendanceStatus: att?.status || '',
        otExpectedStart,
        otExpectedEnd,
        otHours,
        otStatus: primaryOt?.status || (otHours && otHours > 0 ? 'Logged' : ''),
        otRequestCount: dayOtReqs.length,
        netLunchAdjustedHours,
      });
    }

    return rows;
  }, [
    yearNum,
    monthNum,
    daysInMonth,
    monthlyAttendancesByDate,
    monthlyOvertimeRequests,
    monthlyOvertimeAttendancesByDate,
  ]);

  // Summary metrics
  const summary = useMemo(() => {
    const standardWorkingDays =
      Number(payrollSettings?.standardWorkingDaysPerMonth ?? payrollSettings?.workingDaysPerMonth) || 26;
    let presentDays = 0;
    let lateDays = 0;
    let halfDays = 0;
    let absentDays = 0;
    let leaveDays = 0;
    let totalRegularHours = 0;
    let totalDayOvertimeHours = 0;

    dayRows.forEach((r) => {
      if (r.attendanceStatus === 'Present') presentDays += 1;
      else if (r.attendanceStatus === 'Late') lateDays += 1;
      else if (r.attendanceStatus === 'Half Day' || r.attendanceStatus === 'Half-Day') halfDays += 1;
      else if (r.attendanceStatus === 'Absent') absentDays += 1;
      else if (r.attendanceStatus === 'Leave') leaveDays += 1;

      if (r.regularWorkingHours) totalRegularHours += r.regularWorkingHours;
      if (r.otHours) totalDayOvertimeHours += r.otHours;
    });

    const totalAttendanceDays = presentDays + lateDays + halfDays;

    const approvedOtHours = monthlyOvertimeRequests
      .filter((r) => r.status === 'Final Approved')
      .reduce(
        (sum, r) =>
          sum +
          (r.actualOvertimeHours && r.actualOvertimeHours > 0
            ? r.actualOvertimeHours
            : r.expectedHours || 0),
        0
      );

    const actualOtHoursFromReqs = monthlyOvertimeRequests
      .filter((r) => r.status !== 'Rejected' && r.status !== 'Cancelled')
      .reduce((sum, r) => sum + (Number(r.actualOvertimeHours) || 0), 0);

    const actualOtHoursFromLogs = Array.from(monthlyOvertimeAttendancesByDate.values())
      .flat()
      .reduce((sum, a) => sum + (Number(a.actualOvertimeHours) || 0), 0);

    const actualOtHours = Math.round(
      Math.max(actualOtHoursFromReqs, actualOtHoursFromLogs) * 100
    ) / 100;

    const requestedOtHours = monthlyOvertimeRequests
      .filter((r) => r.status !== 'Rejected' && r.status !== 'Cancelled')
      .reduce((sum, r) => sum + (Number(r.expectedHours) || 0), 0);

    const totalNetLunchAdjustedHours = dayRows.reduce(
      (sum, r) => sum + (r.netLunchAdjustedHours || 0),
      0
    );

    return {
      standardWorkingDays,
      totalAttendanceDays,
      presentDays,
      lateDays,
      halfDays,
      absentDays,
      leaveDays,
      totalRegularHours: Math.round(totalRegularHours * 100) / 100,
      totalOvertimeHours: Math.round(totalDayOvertimeHours * 100) / 100,
      totalNetLunchAdjustedHours: Math.round(totalNetLunchAdjustedHours * 100) / 100,
      approvedOtHours: Math.round(approvedOtHours * 100) / 100,
      actualOtHours,
      requestedOtHours: Math.round(requestedOtHours * 100) / 100,
    };
  }, [dayRows, monthlyOvertimeRequests, monthlyOvertimeAttendancesByDate, payrollSettings]);

  const leftHalfRows = useMemo(() => dayRows.slice(0, 16), [dayRows]);
  const rightHalfRows = useMemo(() => dayRows.slice(16), [dayRows]);
  const rightSpacerCount = Math.max(0, 16 - rightHalfRows.length);

  const shiftMonth = (delta: number) => {
    const d = new Date(yearNum, monthNum - 1 + delta, 1);
    setSelectedMonthYear(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const handlePrintCard = () => {
    const bodyClass =
      orientation === 'landscape'
        ? 'printing-attendance-card-landscape'
        : 'printing-attendance-card';
    document.body.classList.add(bodyClass);
    const cleanup = () => {
      document.body.classList.remove('printing-attendance-card');
      document.body.classList.remove('printing-attendance-card-landscape');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 2000);
  };

  if (!isOpen) return null;

  const companyName =
    payrollSettings?.companyName?.trim() ||
    systemSettings?.branding?.softwareName?.trim() ||
    'STERN INDUSTRIES LTD.';
  const companyAddress =
    payrollSettings?.companyAddress?.trim() ||
    '8/A Factory Road, Shyampur I/A, Kadamtoli, Dhaka';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto print:static print:p-0 print:bg-white print:overflow-visible">
      <div className="w-full max-w-6xl max-h-[94vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden print:max-h-none print:border-none print:shadow-none print:rounded-none print:overflow-visible">
        {/* Top Modal Action Bar (Hidden on Print) */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-col lg:flex-row lg:items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-2xs shrink-0">
              <UserCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Employee Attendance Card
              </h3>
              <p className="text-[11px] text-slate-500">
                Monthly Attendance & Overtime Card • Synced with field_force_reps, employee_attendances & overtime_requests
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Employee Picker */}
            <select
              value={activeEmployee?.id || ''}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              aria-label="Select Employee"
              className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100 max-w-[230px]"
            >
              {fieldForceReps.length === 0 ? (
                <option value="">No employees available</option>
              ) : (
                fieldForceReps.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.code} — {emp.name}
                  </option>
                ))
              )}
            </select>

            {/* Month & Year Picker */}
            <div className="inline-flex items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                title="Previous Month"
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-center gap-1 px-1.5">
                <Calendar className="w-3.5 h-3.5 text-blue-600" />
                <input
                  type="month"
                  value={selectedMonthYear}
                  onChange={(e) => e.target.value && setSelectedMonthYear(e.target.value)}
                  aria-label="Select Month and Year"
                  className="py-1 bg-transparent text-xs font-mono font-bold text-slate-800 dark:text-slate-100 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                title="Next Month"
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Print Orientation */}
            <div className="inline-flex rounded-xl bg-slate-200/70 dark:bg-slate-800 p-0.5 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setOrientation('portrait')}
                className={`px-2.5 py-1 rounded-lg transition-colors ${
                  orientation === 'portrait'
                    ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                A4 Portrait
              </button>
              <button
                type="button"
                onClick={() => setOrientation('landscape')}
                className={`px-2.5 py-1 rounded-lg transition-colors ${
                  orientation === 'landscape'
                    ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                A4 Landscape
              </button>
            </div>

            <button
              type="button"
              onClick={fetchCardData}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={handlePrintCard}
              disabled={!activeEmployee}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold shadow-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Attendance Card</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 dark:hover:bg-slate-800"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body Preview Area */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 bg-slate-100 dark:bg-slate-950/80 print:p-0 print:bg-white print:overflow-visible">
          {loadError && (
            <div className="mb-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2 print:hidden">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>{loadError} — showing synchronized ERP records where available.</span>
            </div>
          )}

          {!activeEmployee ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center text-slate-500 text-sm">
              No employee records found. Add employees under Basic Data → Employees first.
            </div>
          ) : (
            <div
              id="employee-attendance-card-print"
              className={`mx-auto bg-white text-slate-900 border border-slate-400 shadow-md p-4 sm:p-5 print:border-black print:shadow-none print:p-2 ${
                orientation === 'landscape' ? 'max-w-[1060px]' : 'max-w-[820px]'
              }`}
            >
              {/* Loading indicator overlay bar on screen */}
              {isLoading && (
                <div className="mb-2 px-3 py-1 rounded bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-semibold flex items-center gap-2 print:hidden">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Loading {monthLabel} attendance & overtime data from Supabase...</span>
                </div>
              )}

              {/* ================================================================= */}
              {/* TOP BOOKLET HEADER: SUMMARY + RULES (LEFT) | COMPANY + EMP (RIGHT) */}
              {/* ================================================================= */}
              <div className="grid grid-cols-1 md:grid-cols-2 border border-slate-800 print:grid-cols-2">
                {/* TOP LEFT PANEL: Monthly Summary & Rules */}
                <div className="p-3 sm:p-4 border-b md:border-b-0 md:border-r border-slate-800 print:border-b-0 print:border-r flex flex-col justify-between bg-amber-50/35 print:bg-white">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700 border-b border-slate-400 pb-1 mb-2 flex items-center justify-between">
                      <span>Monthly Attendance Summary</span>
                      <span className="font-mono text-[10px]">{monthLabel}</span>
                    </div>

                    <div className="space-y-1.5 text-[11px]">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-slate-800 shrink-0">
                          Total Working Days
                        </span>
                        <span className="flex-1 border-b border-dotted border-slate-500" />
                        <span className="font-mono font-bold text-slate-950 min-w-[74px] text-right">
                          {summary.standardWorkingDays} Days
                        </span>
                      </div>

                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-slate-800 shrink-0">
                          Total Attendance Days
                        </span>
                        <span className="flex-1 border-b border-dotted border-slate-500" />
                        <span className="font-mono font-bold text-emerald-800 print:text-black min-w-[74px] text-right">
                          {String(summary.totalAttendanceDays).padStart(2, '0')} Days
                        </span>
                      </div>

                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-slate-800 shrink-0">
                          Total Absence Days
                        </span>
                        <span className="flex-1 border-b border-dotted border-slate-500" />
                        <span className="font-mono font-bold text-rose-700 print:text-black min-w-[74px] text-right">
                          {summary.absentDays} Days
                        </span>
                      </div>

                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-slate-800 shrink-0">
                          Total Late Days
                        </span>
                        <span className="flex-1 border-b border-dotted border-slate-500" />
                        <span className="font-mono font-bold text-amber-700 print:text-black min-w-[74px] text-right">
                          {summary.lateDays} Days
                        </span>
                      </div>

                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-slate-800 shrink-0">
                          Total Overtime Hours
                        </span>
                        <span className="flex-1 border-b border-dotted border-slate-500" />
                        <span className="font-mono font-bold text-blue-800 print:text-black min-w-[74px] text-right">
                          {formatHoursToHMM(summary.totalOvertimeHours)} ({summary.totalOvertimeHours.toFixed(2)}h)
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 pt-1 flex justify-end">
                      <span className="border-t border-slate-700 px-3 pt-0.5 text-[10px] font-semibold text-slate-700">
                        Timekeeper
                      </span>
                    </div>
                  </div>

                  {/* Card Guidelines matching physical reference */}
                  <div className="mt-2 pt-2 border-t border-slate-300 text-[10px] leading-snug text-slate-700">
                    <div className="font-bold underline mb-1 text-slate-900">
                      Card Rules &amp; Guidelines:
                    </div>
                    <ol className="list-decimal list-inside space-y-0.5 text-[9.5px]">
                      <li>This attendance card must be verified daily at the timekeeping desk.</li>
                      <li>Overwriting, erasing, or tampering with entries is strictly prohibited.</li>
                      <li>Only the named employee may use this card; it is non-transferable.</li>
                      <li>Lunch Rule: 1 hour is deducted for lunch where applicable (Working + OT - 1h).</li>
                    </ol>
                    <div className="mt-3 flex justify-end">
                      <span className="border-t border-slate-700 px-4 pt-0.5 text-[10px] font-semibold text-slate-800">
                        Authority
                      </span>
                    </div>
                  </div>
                </div>

                {/* TOP RIGHT PANEL: Company Header + Employee Info */}
                <div className="p-3 sm:p-4 bg-amber-50/35 print:bg-white flex flex-col justify-between">
                  <div>
                    <div className="text-center border-b border-slate-300 pb-2 mb-2.5">
                      <div className="flex items-center justify-center gap-2">
                        {systemSettings?.branding?.logoDataUrl && (
                          <img
                            src={systemSettings.branding.logoDataUrl}
                            alt={companyName}
                            className="h-8 w-auto object-contain"
                          />
                        )}
                        <div>
                          <h1 className="text-base font-black tracking-tight text-slate-950 uppercase">
                            {companyName}
                          </h1>
                          <p className="text-[10px] text-slate-600 leading-tight">{companyAddress}</p>
                        </div>
                      </div>
                      <div className="inline-block mt-2 px-4 py-0.5 border-2 border-slate-900 text-xs font-black tracking-widest uppercase bg-white">
                        ATTENDANCE CARD / হাজিরা কার্ড
                      </div>
                    </div>

                    {/* Employee Information Ruled Fields */}
                    <div className="space-y-1 text-[10.5px]">
                      <div className="grid grid-cols-12 gap-2 items-baseline">
                        <span className="col-span-4 font-semibold text-slate-700">
                          Office Code:
                        </span>
                        <span className="col-span-8 border-b border-dotted border-slate-600 font-mono font-bold text-slate-950">
                          {activeEmployee.assignedOfficeId || 'HO-001'}
                          {(activeEmployee.assignedOfficeName || activeEmployee.branchWorkplace) && (
                            <span className="ml-1.5 font-sans text-[10px] font-normal text-slate-600">
                              — {activeEmployee.assignedOfficeName || activeEmployee.branchWorkplace}
                            </span>
                          )}
                        </span>
                      </div>

                      <div className="grid grid-cols-12 gap-2 items-baseline">
                        <span className="col-span-4 font-semibold text-slate-700">
                          Employee ID / Code:
                        </span>
                        <span className="col-span-8 border-b border-dotted border-slate-600 font-mono font-bold text-slate-950">
                          {activeEmployee.code || activeEmployee.id}{' '}
                          <span className="text-[10px] font-normal text-slate-500">
                            (ID #{activeEmployee.id}
                            {(activeEmployee.shiftStartTime || payrollSettings?.shiftStartTime) &&
                              ` • Shift ${activeEmployee.shiftStartTime || payrollSettings?.shiftStartTime}–${activeEmployee.shiftEndTime || payrollSettings?.shiftEndTime || '17:00'}`}
                            )
                          </span>
                        </span>
                      </div>

                      <div className="grid grid-cols-12 gap-2 items-baseline">
                        <span className="col-span-4 font-semibold text-slate-700">
                          Full Name (English):
                        </span>
                        <span className="col-span-8 border-b border-dotted border-slate-600 font-bold text-slate-950">
                          {activeEmployee.name}
                        </span>
                      </div>

                      <div className="grid grid-cols-12 gap-2 items-baseline">
                        <span className="col-span-4 font-semibold text-slate-700">
                          Designation / Position:
                        </span>
                        <span className="col-span-8 border-b border-dotted border-slate-600 font-semibold text-slate-900">
                          {activeEmployee.designation || '—'}
                        </span>
                      </div>

                      <div className="grid grid-cols-12 gap-2 items-baseline">
                        <span className="col-span-4 font-semibold text-slate-700">
                          Employment Type:
                        </span>
                        <span className="col-span-8 border-b border-dotted border-slate-600 font-medium text-slate-900">
                          {activeEmployee.employmentType || activeEmployee.fieldForceType || '—'}
                        </span>
                      </div>

                      <div className="grid grid-cols-12 gap-2 items-baseline">
                        <span className="col-span-4 font-semibold text-slate-700">
                          Employee Category:
                        </span>
                        <span className="col-span-8 border-b border-dotted border-slate-600 font-medium text-slate-900">
                          {activeEmployee.employeeCategory || '—'}
                        </span>
                      </div>

                      <div className="grid grid-cols-12 gap-2 items-baseline">
                        <span className="col-span-4 font-semibold text-slate-700">
                          Department:
                        </span>
                        <span className="col-span-8 border-b border-dotted border-slate-600 font-medium text-slate-900">
                          {activeEmployee.department || '—'}
                        </span>
                      </div>

                      <div className="grid grid-cols-12 gap-2 items-baseline pt-0.5">
                        <span className="col-span-4 font-semibold text-slate-700">
                          Month &amp; Year:
                        </span>
                        <span className="col-span-8 border-b border-dotted border-slate-600 font-mono font-bold text-slate-950">
                          {MONTH_NAMES[monthNum - 1]} ({String(monthNum).padStart(2, '0')}) / {yearNum}{' '}
                          <span className="font-sans text-[10px] font-normal text-slate-600">
                            • {daysInMonth} Days
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ================================================================= */}
              {/* BOTTOM HALF: SPLIT DAILY ATTENDANCE GRID (1-16 | 17-28/29/30/31)  */}
              {/* ================================================================= */}
              <div className="mt-2.5 grid grid-cols-1 lg:grid-cols-2 gap-0 border border-slate-900 print:grid-cols-2">
                {/* LEFT TABLE: Days 1 to 16 */}
                <div className="border-b lg:border-b-0 lg:border-r border-slate-900 print:border-b-0 print:border-r">
                  <table className="w-full border-collapse text-[10px] tabular-nums">
                    <thead>
                      <tr className="bg-amber-100/60 print:bg-slate-100 text-slate-900 font-bold">
                        <th rowSpan={2} className="border-b border-r border-slate-800 px-1 py-1 text-center w-11">
                          Date
                        </th>
                        <th colSpan={3} className="border-b border-r border-slate-800 px-1 py-0.5 text-center">
                          Regular Time
                        </th>
                        <th colSpan={3} className="border-b border-r border-slate-800 px-1 py-0.5 text-center">
                          Overtime (OT)
                        </th>
                        <th rowSpan={2} className="border-b border-slate-800 px-1 py-1 text-center">
                          Status
                        </th>
                      </tr>
                      <tr className="bg-amber-50/70 print:bg-slate-50 text-[9px] font-bold text-slate-800">
                        <th className="border-b border-r border-slate-700 px-1 py-0.5 text-center">In</th>
                        <th className="border-b border-r border-slate-700 px-1 py-0.5 text-center">Out</th>
                        <th className="border-b border-r border-slate-700 px-1 py-0.5 text-center">Reg</th>
                        <th className="border-b border-r border-slate-700 px-1 py-0.5 text-center">Start</th>
                        <th className="border-b border-r border-slate-700 px-1 py-0.5 text-center">End</th>
                        <th className="border-b border-r border-slate-700 px-1 py-0.5 text-center">Hrs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leftHalfRows.map((r) => (
                        <tr
                          key={r.dateIso}
                          className={r.isWeekendFriday ? 'bg-slate-50/80 print:bg-slate-50' : 'bg-white'}
                        >
                          <td className="border-b border-r border-slate-400 px-1 py-0.5 text-center font-mono font-bold">
                            {r.day}{' '}
                            <span className="text-[8px] font-normal text-slate-500">{r.weekdayShort}</span>
                          </td>
                          <td className="border-b border-r border-slate-400 px-1 py-0.5 text-center font-mono">
                            {r.checkInTime || ''}
                          </td>
                          <td className="border-b border-r border-slate-400 px-1 py-0.5 text-center font-mono">
                            {r.checkOutTime || ''}
                          </td>
                          <td className="border-b border-r border-slate-400 px-1 py-0.5 text-center font-mono font-semibold">
                            {r.regularWorkingHours !== null && r.regularWorkingHours > 0
                              ? r.regularWorkingHours.toFixed(2)
                              : ''}
                          </td>
                          <td className="border-b border-r border-slate-400 px-1 py-0.5 text-center font-mono">
                            {r.otExpectedStart || ''}
                          </td>
                          <td className="border-b border-r border-slate-400 px-1 py-0.5 text-center font-mono">
                            {r.otExpectedEnd || ''}
                          </td>
                          <td className="border-b border-r border-slate-400 px-1 py-0.5 text-center font-mono font-semibold">
                            {r.otHours !== null && r.otHours > 0 ? r.otHours.toFixed(2) : ''}
                          </td>
                          <td className="border-b border-slate-400 px-1 py-0.5 text-center text-[9px] font-bold">
                            {r.attendanceStatus ? (
                              <span
                                className={
                                  r.attendanceStatus === 'Present'
                                    ? 'text-emerald-700 print:text-black'
                                    : r.attendanceStatus === 'Late'
                                    ? 'text-amber-700 print:text-black'
                                    : r.attendanceStatus === 'Absent'
                                    ? 'text-rose-700 print:text-black'
                                    : 'text-indigo-700 print:text-black'
                                }
                              >
                                {r.attendanceStatus}
                              </span>
                            ) : (
                              ''
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* RIGHT TABLE: Days 17 to daysInMonth (28/29/30/31) */}
                <div>
                  <table className="w-full border-collapse text-[10px] tabular-nums">
                    <thead>
                      <tr className="bg-amber-100/60 print:bg-slate-100 text-slate-900 font-bold">
                        <th rowSpan={2} className="border-b border-r border-slate-800 px-1 py-1 text-center w-11">
                          Date
                        </th>
                        <th colSpan={3} className="border-b border-r border-slate-800 px-1 py-0.5 text-center">
                          Regular Time
                        </th>
                        <th colSpan={3} className="border-b border-r border-slate-800 px-1 py-0.5 text-center">
                          Overtime (OT)
                        </th>
                        <th rowSpan={2} className="border-b border-slate-800 px-1 py-1 text-center">
                          Status
                        </th>
                      </tr>
                      <tr className="bg-amber-50/70 print:bg-slate-50 text-[9px] font-bold text-slate-800">
                        <th className="border-b border-r border-slate-700 px-1 py-0.5 text-center">In</th>
                        <th className="border-b border-r border-slate-700 px-1 py-0.5 text-center">Out</th>
                        <th className="border-b border-r border-slate-700 px-1 py-0.5 text-center">Reg</th>
                        <th className="border-b border-r border-slate-700 px-1 py-0.5 text-center">Start</th>
                        <th className="border-b border-r border-slate-700 px-1 py-0.5 text-center">End</th>
                        <th className="border-b border-r border-slate-700 px-1 py-0.5 text-center">Hrs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rightHalfRows.map((r) => (
                        <tr
                          key={r.dateIso}
                          className={r.isWeekendFriday ? 'bg-slate-50/80 print:bg-slate-50' : 'bg-white'}
                        >
                          <td className="border-b border-r border-slate-400 px-1 py-0.5 text-center font-mono font-bold">
                            {r.day}{' '}
                            <span className="text-[8px] font-normal text-slate-500">{r.weekdayShort}</span>
                          </td>
                          <td className="border-b border-r border-slate-400 px-1 py-0.5 text-center font-mono">
                            {r.checkInTime || ''}
                          </td>
                          <td className="border-b border-r border-slate-400 px-1 py-0.5 text-center font-mono">
                            {r.checkOutTime || ''}
                          </td>
                          <td className="border-b border-r border-slate-400 px-1 py-0.5 text-center font-mono font-semibold">
                            {r.regularWorkingHours !== null && r.regularWorkingHours > 0
                              ? r.regularWorkingHours.toFixed(2)
                              : ''}
                          </td>
                          <td className="border-b border-r border-slate-400 px-1 py-0.5 text-center font-mono">
                            {r.otExpectedStart || ''}
                          </td>
                          <td className="border-b border-r border-slate-400 px-1 py-0.5 text-center font-mono">
                            {r.otExpectedEnd || ''}
                          </td>
                          <td className="border-b border-r border-slate-400 px-1 py-0.5 text-center font-mono font-semibold">
                            {r.otHours !== null && r.otHours > 0 ? r.otHours.toFixed(2) : ''}
                          </td>
                          <td className="border-b border-slate-400 px-1 py-0.5 text-center text-[9px] font-bold">
                            {r.attendanceStatus ? (
                              <span
                                className={
                                  r.attendanceStatus === 'Present'
                                    ? 'text-emerald-700 print:text-black'
                                    : r.attendanceStatus === 'Late'
                                    ? 'text-amber-700 print:text-black'
                                    : r.attendanceStatus === 'Absent'
                                    ? 'text-rose-700 print:text-black'
                                    : 'text-indigo-700 print:text-black'
                                }
                              >
                                {r.attendanceStatus}
                              </span>
                            ) : (
                              ''
                            )}
                          </td>
                        </tr>
                      ))}
                      {Array.from({ length: rightSpacerCount }).map((_, idx) => (
                        <tr key={`spacer-${idx}`} className="bg-slate-50/40">
                          <td className="border-b border-r border-slate-300 px-1 py-0.5 text-center text-slate-300">
                            —
                          </td>
                          <td className="border-b border-r border-slate-300 px-1 py-0.5" />
                          <td className="border-b border-r border-slate-300 px-1 py-0.5" />
                          <td className="border-b border-r border-slate-300 px-1 py-0.5" />
                          <td className="border-b border-r border-slate-300 px-1 py-0.5" />
                          <td className="border-b border-r border-slate-300 px-1 py-0.5" />
                          <td className="border-b border-r border-slate-300 px-1 py-0.5" />
                          <td className="border-b border-slate-300 px-1 py-0.5" />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ================================================================= */}
              {/* OVERTIME DETAILS & BREAKDOWN (from overtime_requests)             */}
              {/* ================================================================= */}
              <div className="mt-2.5 border border-slate-800 p-2.5 bg-slate-50/40 print:bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-300 text-[10px]">
                  <div className="font-bold uppercase tracking-wide text-slate-900 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-blue-600 print:text-black" />
                    <span>Overtime Details ({monthLabel})</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 font-mono text-[10px]">
                    <span>
                      Approved OT: <b>{summary.approvedOtHours.toFixed(2)}h</b>
                    </span>
                    <span>
                      Actual OT: <b>{summary.actualOtHours.toFixed(2)}h</b>
                    </span>
                    <span>
                      Requested OT: <b>{summary.requestedOtHours.toFixed(2)}h</b>
                    </span>
                    <span>
                      Regular Hrs: <b>{summary.totalRegularHours.toFixed(2)}h</b>
                    </span>
                    <span>
                      Net (-1h Lunch): <b>{summary.totalNetLunchAdjustedHours.toFixed(2)}h</b>
                    </span>
                  </div>
                </div>

                {monthlyOvertimeRequests.length === 0 ? (
                  <div className="py-2 text-[10px] text-slate-500 flex items-center gap-1.5">
                    <FileText className="w-3 h-3" />
                    <span>No overtime requests recorded for {activeEmployee.name} in {monthLabel}.</span>
                  </div>
                ) : (
                  <table className="w-full border-collapse text-[10px] mt-1.5 tabular-nums">
                    <thead>
                      <tr className="bg-slate-100 text-slate-800 font-bold text-[9.5px]">
                        <th className="border border-slate-400 px-1.5 py-0.5 text-left">Request #</th>
                        <th className="border border-slate-400 px-1.5 py-0.5 text-center">Date</th>
                        <th className="border border-slate-400 px-1.5 py-0.5 text-center">
                          Expected Start Time
                        </th>
                        <th className="border border-slate-400 px-1.5 py-0.5 text-center">
                          Expected End Time
                        </th>
                        <th className="border border-slate-400 px-1.5 py-0.5 text-right">
                          Approved / Expected Hrs
                        </th>
                        <th className="border border-slate-400 px-1.5 py-0.5 text-right">
                          Actual OT Hrs
                        </th>
                        <th className="border border-slate-400 px-1.5 py-0.5 text-center">
                          Overtime Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyOvertimeRequests.map((req) => {
                        const matchedAtts = monthlyOvertimeAttendancesByDate.get(req.overtimeDate) || [];
                        const matchedAtt = matchedAtts.find((a) => a.requestId === req.id);
                        const actualHrs =
                          matchedAtt && matchedAtt.actualOvertimeHours > 0
                            ? matchedAtt.actualOvertimeHours
                            : req.actualOvertimeHours && req.actualOvertimeHours > 0
                            ? req.actualOvertimeHours
                            : null;
                        return (
                          <tr key={req.id}>
                            <td className="border border-slate-300 px-1.5 py-0.5 font-mono font-semibold">
                              {req.requestNumber}
                            </td>
                            <td className="border border-slate-300 px-1.5 py-0.5 text-center font-mono">
                              {req.overtimeDate}
                            </td>
                            <td className="border border-slate-300 px-1.5 py-0.5 text-center font-mono">
                              {normalizeTimeDisplay(req.expectedStartTime) || '—'}
                            </td>
                            <td className="border border-slate-300 px-1.5 py-0.5 text-center font-mono">
                              {normalizeTimeDisplay(req.expectedEndTime) || '—'}
                            </td>
                            <td className="border border-slate-300 px-1.5 py-0.5 text-right font-mono font-bold">
                              {(Number(req.expectedHours) || 0).toFixed(2)}h
                            </td>
                            <td className="border border-slate-300 px-1.5 py-0.5 text-right font-mono">
                              {actualHrs !== null ? `${actualHrs.toFixed(2)}h` : '—'}
                            </td>
                            <td className="border border-slate-300 px-1.5 py-0.5 text-center font-bold">
                              {req.status}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* ================================================================= */}
              {/* BOTTOM SIGNATURES & LUNCH FORMULA NOTE                            */}
              {/* ================================================================= */}
              <div className="mt-5 pt-2 flex items-end justify-between text-[10px] text-slate-800">
                <div className="text-center">
                  <div className="w-40 border-t border-slate-800 pt-1 font-bold">
                    Employee Signature
                  </div>
                </div>
                <div className="text-[9px] text-slate-500 text-center px-2">
                  Generated on {new Date().toLocaleDateString('en-GB')} • {activeEmployee.code}
                </div>
                <div className="text-center">
                  <div className="w-44 border-t border-slate-800 pt-1 font-bold">
                    Administrative Officer Signature
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
