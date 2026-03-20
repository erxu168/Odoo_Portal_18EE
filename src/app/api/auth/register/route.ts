/**
 * POST /api/auth/register
 *
 * Self-registration for employees.
 * 1. Accept email or phone
 * 2. Search hr.employee in Odoo (work_email, private_email, mobile_phone)
 * 3. Check for duplicate email or employee_id
 * 4. Create account with status='pending'
 * 5. Send email notification to admin + dept manager
 *
 * Body: { identifier: string, password: string }
 * identifier = email or phone (+49...)
 */
import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import {
  getUserByEmail,
  getUserByEmployeeId,
  createUser,
  checkRegistrationRateLimit,
  recordRegistrationAttempt,
} from '@/lib/db';

function isPhone(s: string): boolean {
  return /^\+\d/.test(s.trim());
}

function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/\d/.test(pw)) return 'Password must contain at least one number.';
  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { identifier, password } = body;

    if (!identifier || !password) {
      return NextResponse.json({ error: 'Email/phone and password are required.' }, { status: 400 });
    }

    const id = identifier.trim();

    // Validate password
    const pwError = validatePassword(password);
    if (pwError) {
      return NextResponse.json({ error: pwError }, { status: 400 });
    }

    // Phone format check
    if (isPhone(id) && !id.startsWith('+')) {
      return NextResponse.json({ error: 'Phone number must include country code (e.g. +49...).' }, { status: 400 });
    }

    // Rate limit
    const rateCheck = checkRegistrationRateLimit(id);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Too many attempts. Try again in ${rateCheck.retryAfterMin} minutes.` },
        { status: 429 }
      );
    }
    recordRegistrationAttempt(id);

    // Check if email already exists in portal
    if (!isPhone(id)) {
      const existing = getUserByEmail(id.toLowerCase());
      if (existing) {
        if (existing.status === 'rejected') {
          return NextResponse.json({
            error: 'This account was previously rejected. Contact your manager to clear the rejection before registering again.',
            code: 'REJECTED',
          }, { status: 409 });
        }
        return NextResponse.json({
          error: 'An account with this email already exists. Try logging in instead.',
          code: 'DUPLICATE_EMAIL',
        }, { status: 409 });
      }
    }

    // Search Odoo hr.employee
    const odoo = getOdoo();
    let domain: any[] = [];
    if (isPhone(id)) {
      domain = [['mobile_phone', '=', id]];
    } else {
      domain = ['|', ['work_email', '=ilike', id], ['private_email', '=ilike', id]];
    }

    const employees = await odoo.searchRead('hr.employee', domain,
      ['id', 'name', 'department_id', 'work_email', 'private_email', 'mobile_phone'],
      { limit: 1 }
    );

    if (!employees || employees.length === 0) {
      return NextResponse.json({
        error: 'No employee found with that email or phone number. Make sure you are using the same email you gave when you were hired.',
        code: 'NO_MATCH',
      }, { status: 404 });
    }

    const emp = employees[0];

    // Check if this employee_id already has a portal account
    const existingByEmp = getUserByEmployeeId(emp.id);
    if (existingByEmp) {
      if (existingByEmp.status === 'rejected') {
        return NextResponse.json({
          error: 'This account was previously rejected. Contact your manager to clear the rejection before registering again.',
          code: 'REJECTED',
        }, { status: 409 });
      }
      return NextResponse.json({
        error: 'An account for this employee already exists. Try logging in with your registered email.',
        code: 'DUPLICATE_EMPLOYEE',
        existing_email: existingByEmp.email,
      }, { status: 409 });
    }

    // Use the identifier as the portal email
    const portalEmail = isPhone(id) ? (emp.work_email || emp.private_email || id) : id;

    // Create pending account
    const userId = createUser(
      emp.name,
      portalEmail.toLowerCase().trim(),
      password,
      'staff',
      { employee_id: emp.id, status: 'pending' }
    );

    // Get department manager for contact info
    let managerName = 'Ethan';
    if (emp.department_id) {
      try {
        const depts = await odoo.searchRead('hr.department',
          [['id', '=', emp.department_id[0]]],
          ['manager_id'],
          { limit: 1 }
        );
        if (depts && depts[0]?.manager_id) {
          managerName = depts[0].manager_id[1];
        }
      } catch (e) {
        // fallback to Ethan
      }
    }

    // Send email notification (best effort, don't block registration)
    try {
      await sendRegistrationNotification(emp.name, emp.department_id?.[1] || 'Unknown', portalEmail);
    } catch (e) {
      console.error('Failed to send registration notification:', e);
    }

    return NextResponse.json({
      message: 'Account created. Waiting for approval.',
      user_id: userId,
      employee: {
        name: emp.name,
        department: emp.department_id?.[1] || null,
      },
      contact: managerName,
    }, { status: 201 });

  } catch (error: any) {
    console.error('POST /api/auth/register error:', error);
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 });
  }
}

/**
 * GET /api/auth/register?identifier=xxx
 *
 * Preview: search Odoo employee without creating an account.
 * Used by the frontend to show "Is this you?" before password step.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('identifier')?.trim();
    if (!id) {
      return NextResponse.json({ error: 'identifier required' }, { status: 400 });
    }

    // Rate limit
    const rateCheck = checkRegistrationRateLimit(id);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Too many attempts. Try again in ${rateCheck.retryAfterMin} minutes.` },
        { status: 429 }
      );
    }
    recordRegistrationAttempt(id);

    // Check existing portal user
    if (!isPhone(id)) {
      const existing = getUserByEmail(id.toLowerCase());
      if (existing) {
        const code = existing.status === 'rejected' ? 'REJECTED' : 'DUPLICATE_EMAIL';
        return NextResponse.json({ code, status: existing.status }, { status: 409 });
      }
    }

    // Search Odoo
    const odoo = getOdoo();
    let domain: any[] = [];
    if (isPhone(id)) {
      domain = [['mobile_phone', '=', id]];
    } else {
      domain = ['|', ['work_email', '=ilike', id], ['private_email', '=ilike', id]];
    }

    const employees = await odoo.searchRead('hr.employee', domain,
      ['id', 'name', 'department_id', 'work_email'],
      { limit: 1 }
    );

    if (!employees || employees.length === 0) {
      return NextResponse.json({ code: 'NO_MATCH' }, { status: 404 });
    }

    const emp = employees[0];

    // Check employee_id duplicate
    const existingByEmp = getUserByEmployeeId(emp.id);
    if (existingByEmp) {
      const code = existingByEmp.status === 'rejected' ? 'REJECTED' : 'DUPLICATE_EMPLOYEE';
      return NextResponse.json({ code, existing_email: existingByEmp.email }, { status: 409 });
    }

    return NextResponse.json({
      employee: {
        id: emp.id,
        name: emp.name,
        department: emp.department_id?.[1] || null,
      },
    });

  } catch (error: any) {
    console.error('GET /api/auth/register error:', error);
    return NextResponse.json({ error: 'Lookup failed. Please try again.' }, { status: 500 });
  }
}

async function sendRegistrationNotification(empName: string, deptName: string, email: string) {
  // Use nodemailer if configured, otherwise just log
  const nodemailer = await import('nodemailer').catch(() => null);
  if (!nodemailer || !process.env.SMTP_HOST) {
    console.log(`[REGISTRATION] New registration: ${empName} (${deptName}) - ${email}. Email notification skipped (no SMTP configured).`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const adminEmail = process.env.ADMIN_EMAIL || process.env.ODOO_USER || 'biz@krawings.de';
  const subject = `New portal registration: ${empName} (${deptName})`;
  const html = `<p><strong>${empName}</strong> from <strong>${deptName}</strong> has registered for the Krawings Portal.</p>
    <p>Email: ${email}</p>
    <p>Go to the portal admin to approve or reject this registration.</p>`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || adminEmail,
    to: adminEmail,
    subject,
    html,
  });
}
