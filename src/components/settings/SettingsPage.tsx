import React, { useState, useEffect, useRef } from 'react';
import {
  Settings,
  Palette,
  Upload,
  RotateCcw,
  Save,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Lock,
  Image as ImageIcon,
  Layers,
  Sparkles,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext.tsx';
import { BrandLogoMark } from '../common/BrandLogoMark.tsx';
import {
  DEFAULT_SOFTWARE_NAME,
  formatDocumentTitle,
} from '../../types/systemSettings.ts';
import { canModifySystemBranding } from '../../lib/systemSettingsPermissions.ts';

type SettingsSectionId = 'branding';

interface SettingsSectionDef {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: 'branding',
    label: 'System Branding',
    description: 'Software name, logo, and global identity',
    icon: Palette,
  },
];

const ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
];

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // 3 MB

export const SettingsPage: React.FC = () => {
  const {
    currentUser,
    systemBranding,
    updateSystemBranding,
  } = useERP();

  const [activeSection, setActiveSection] = useState<SettingsSectionId>('branding');
  const canEditBranding = canModifySystemBranding(currentUser);

  // Local form draft state synchronized with centralized systemBranding
  const [softwareName, setSoftwareName] = useState<string>(
    systemBranding.softwareName || DEFAULT_SOFTWARE_NAME
  );
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(
    systemBranding.logoDataUrl || null
  );
  const [logoFileName, setLogoFileName] = useState<string | null>(
    systemBranding.logoFileName || null
  );
  const [logoMimeType, setLogoMimeType] = useState<string | null>(
    systemBranding.logoMimeType || null
  );

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync draft when server-hydrated branding arrives or updates
  useEffect(() => {
    setSoftwareName(systemBranding.softwareName || DEFAULT_SOFTWARE_NAME);
    setLogoDataUrl(systemBranding.logoDataUrl || null);
    setLogoFileName(systemBranding.logoFileName || null);
    setLogoMimeType(systemBranding.logoMimeType || null);
  }, [
    systemBranding.softwareName,
    systemBranding.logoDataUrl,
    systemBranding.logoFileName,
    systemBranding.logoMimeType,
  ]);

  const hasUnsavedChanges =
    softwareName.trim() !== (systemBranding.softwareName || DEFAULT_SOFTWARE_NAME) ||
    (logoDataUrl || null) !== (systemBranding.logoDataUrl || null);

  const processLogoFile = (file: File) => {
    if (!canEditBranding) {
      setFeedback({
        type: 'error',
        message: 'Permission Denied: Only authorized Admin users can modify System Branding.',
      });
      return;
    }

    const isImageMime =
      ACCEPTED_IMAGE_TYPES.includes(file.type.toLowerCase()) ||
      /\.(png|jpe?g|webp|svg|ico)$/i.test(file.name);

    if (!isImageMime) {
      setFeedback({
        type: 'error',
        message: 'Unsupported file format. Please upload a PNG, JPG, WEBP, SVG, or ICO image.',
      });
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setFeedback({
        type: 'error',
        message: 'Logo file is too large. Please upload an image smaller than 3 MB.',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null;
      if (!result || !result.startsWith('data:image/')) {
        setFeedback({
          type: 'error',
          message: 'Could not read the selected image file. Please try another file.',
        });
        return;
      }
      setLogoDataUrl(result);
      setLogoFileName(file.name);
      setLogoMimeType(file.type || null);
      setFeedback(null);
    };
    reader.onerror = () => {
      setFeedback({
        type: 'error',
        message: 'Failed to read the selected logo file.',
      });
    };
    reader.readAsDataURL(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processLogoFile(file);
    }
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processLogoFile(file);
    }
  };

  const handleResetLogo = () => {
    if (!canEditBranding) return;
    setLogoDataUrl(null);
    setLogoFileName(null);
    setLogoMimeType(null);
    setFeedback(null);
  };

  const handleSaveChanges = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditBranding) {
      setFeedback({
        type: 'error',
        message: 'Permission Denied: Only authorized Admin users can modify System Branding.',
      });
      return;
    }

    const cleanName = softwareName.trim();
    if (!cleanName) {
      setFeedback({
        type: 'error',
        message: 'Software Name cannot be empty.',
      });
      return;
    }

    if (cleanName.length > 80) {
      setFeedback({
        type: 'error',
        message: 'Software Name must be 80 characters or fewer.',
      });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    const res = await updateSystemBranding({
      softwareName: cleanName,
      logoDataUrl,
      logoFileName,
      logoMimeType,
    });

    setIsSaving(false);

    if (res.success) {
      setFeedback({
        type: 'success',
        message:
          'System branding saved successfully. The new Software Name and Logo are now active globally across the ERP.',
      });
    } else {
      setFeedback({
        type: 'error',
        message: res.error || 'Failed to save system branding changes.',
      });
    }
  };

  const previewName = softwareName.trim() || DEFAULT_SOFTWARE_NAME;
  const previewBranding = {
    softwareName: previewName,
    logoDataUrl,
  };
  const showErpBadge = !/\berp\b/i.test(previewName);

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-10">
      {/* Page Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-sm shrink-0">
            <Settings className="w-5.5 h-5.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-extrabold text-slate-900 dark:text-white tracking-tight">
                System Settings
              </h1>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200/70 dark:border-blue-800/60">
                Global Configuration
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Manage centralized platform-wide settings and white-label branding across all users and sessions.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-semibold">
          {canEditBranding ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/70">
              <ShieldCheck className="w-3.5 h-3.5" />
              Admin Write Access
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/70">
              <Lock className="w-3.5 h-3.5" />
              Read-Only Access
            </span>
          )}
        </div>
      </div>

      {/* Scalable 2-Column Settings Architecture */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Navigation Rail (Extensible for Future Settings Sections) */}
        <aside className="lg:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 shadow-xs space-y-2">
          <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Configuration Sections
          </div>

          <nav className="space-y-1">
            {SETTINGS_SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const isSelected = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setActiveSection(sec.id)}
                  className={`w-full flex items-start gap-2.5 p-2.5 rounded-xl text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      isSelected ? 'text-white' : 'text-slate-400'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-bold leading-tight">{sec.label}</div>
                    <div
                      className={`text-[10px] mt-0.5 leading-snug ${
                        isSelected ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {sec.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>

          <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800 px-2.5 pb-1">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 dark:text-slate-500">
              <Layers className="w-3.5 h-3.5" />
              <span>Modular Settings Registry</span>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 leading-relaxed">
              Additional system-wide configuration modules will appear in this navigation rail.
            </p>
          </div>
        </aside>

        {/* Right Main Configuration Panel */}
        <section className="lg:col-span-9 space-y-5">
          {activeSection === 'branding' && (
            <form
              onSubmit={handleSaveChanges}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden"
            >
              {/* Section Header */}
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-slate-50/60 dark:bg-slate-800/30">
                <div>
                  <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span>System Branding</span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Customize the application name and logo displayed in the sidebar, login gateway, and browser tab.
                  </p>
                </div>
                {systemBranding.updatedAt && (
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                    Last updated {new Date(systemBranding.updatedAt).toLocaleString()}
                    {systemBranding.updatedBy ? ` by ${systemBranding.updatedBy}` : ''}
                  </div>
                )}
              </div>

              <div className="p-6 space-y-6">
                {/* Permission Read-Only Alert */}
                {!canEditBranding && (
                  <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs flex items-center gap-2.5">
                    <Lock className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>
                      You have view-only access to System Settings. Only authorized Admin users can modify System Branding.
                    </span>
                  </div>
                )}

                {/* Feedback Banner */}
                {feedback && (
                  <div
                    className={`p-3.5 rounded-xl border text-xs flex items-center gap-2.5 animate-in fade-in ${
                      feedback.type === 'success'
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                        : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                    }`}
                  >
                    {feedback.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                    )}
                    <span className="font-medium">{feedback.message}</span>
                  </div>
                )}

                {/* A. Software Name */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="software-name-input"
                      className="block text-xs font-bold text-slate-800 dark:text-slate-200"
                    >
                      Software Name
                    </label>
                    <span className="text-[10px] font-medium text-slate-400">
                      Default: &quot;{DEFAULT_SOFTWARE_NAME}&quot; • Max 80 chars
                    </span>
                  </div>
                  <input
                    id="software-name-input"
                    name="softwareName"
                    type="text"
                    required
                    maxLength={80}
                    disabled={!canEditBranding || isSaving}
                    value={softwareName}
                    onChange={(e) => {
                      setSoftwareName(e.target.value);
                      if (feedback) setFeedback(null);
                    }}
                    placeholder="Enter software name (e.g. Ensec or Aman ERP)"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Displayed across the sidebar header, login gateway title, mobile header, and browser tab title (
                    <span className="font-mono text-slate-600 dark:text-slate-300">
                      {formatDocumentTitle(previewName)}
                    </span>
                    ).
                  </p>
                </div>

                {/* B. Software Logo / Icon */}
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                        Software Logo / Icon
                      </label>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Upload a square or horizontal brand logo (PNG, JPG, WEBP, SVG, or ICO up to 3 MB). Stored persistently on the server for all users.
                      </p>
                    </div>
                    {logoDataUrl && canEditBranding && (
                      <button
                        type="button"
                        onClick={handleResetLogo}
                        disabled={isSaving}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reset to Default Icon</span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
                    {/* Current Logo Preview Card */}
                    <div className="md:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 flex flex-col items-center justify-center text-center gap-3">
                      <BrandLogoMark branding={previewBranding} size="xl" />
                      <div className="space-y-0.5">
                        <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          {logoDataUrl ? 'Custom Logo Configured' : 'Default System Icon'}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                          {logoDataUrl
                            ? logoFileName || 'Persistent brand logo asset'
                            : 'Using standard gradient emblem'}
                        </div>
                      </div>
                    </div>

                    {/* Upload / Replace Dropzone */}
                    <div
                      onDragOver={(e) => {
                        if (!canEditBranding) return;
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                      }}
                      onDrop={handleDrop}
                      className={`md:col-span-7 rounded-xl border-2 border-dashed p-5 flex flex-col items-center justify-center text-center gap-2.5 transition-all ${
                        isDragging
                          ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/30'
                          : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/40'
                      } ${!canEditBranding ? 'opacity-60 pointer-events-none' : ''}`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp,.svg,.ico,image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon"
                        onChange={handleFileInputChange}
                        disabled={!canEditBranding || isSaving}
                        className="hidden"
                      />
                      <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                        <ImageIcon className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          {logoDataUrl ? 'Replace Existing Logo' : 'Upload Brand Logo or Icon'}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          Drag and drop your image here, or browse from your device
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!canEditBranding || isSaving}
                        className="mt-1 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>{logoDataUrl ? 'Replace Logo' : 'Choose Logo File'}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Live Placement Preview (Sidebar + Login Gateway) */}
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Live Branding Preview
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Sidebar Top Preview */}
                    <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 space-y-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Sidebar Header
                      </div>
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                        <BrandLogoMark branding={previewBranding} size="sm" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="font-black text-sm tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 bg-clip-text text-transparent truncate">
                              {previewName}
                            </span>
                            {showErpBadge && (
                              <span className="text-[9px] uppercase font-bold tracking-wider px-1 py-0.2 rounded bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 shrink-0">
                                ERP
                              </span>
                            )}
                          </div>
                          <p className="text-[9px] text-slate-500 dark:text-slate-400 leading-none">
                            Enterprise Resource Planning
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Login Page Header Preview */}
                    <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 space-y-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Login Gateway
                      </div>
                      <div className="px-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                        <BrandLogoMark branding={previewBranding} size="md" />
                        <div className="min-w-0">
                          <div className="text-xs font-extrabold text-slate-900 dark:text-white truncate">
                            Welcome to {previewName}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            Sign in with your User ID and Password
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer Save Action */}
              <div className="px-6 py-4 bg-slate-50/80 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {hasUnsavedChanges ? (
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      You have unsaved branding changes.
                    </span>
                  ) : (
                    <span>All system branding settings are synchronized.</span>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  {hasUnsavedChanges && canEditBranding && (
                    <button
                      type="button"
                      onClick={() => {
                        setSoftwareName(systemBranding.softwareName || DEFAULT_SOFTWARE_NAME);
                        setLogoDataUrl(systemBranding.logoDataUrl || null);
                        setLogoFileName(systemBranding.logoFileName || null);
                        setLogoMimeType(systemBranding.logoMimeType || null);
                        setFeedback(null);
                      }}
                      disabled={isSaving}
                      className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Discard
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={!canEditBranding || isSaving}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-bold shadow-sm flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Save className="w-4 h-4" />
                    <span>{isSaving ? 'Saving Changes...' : 'Save Changes'}</span>
                  </button>
                </div>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
};
