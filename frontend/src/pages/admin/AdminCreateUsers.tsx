import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, GraduationCap, ShieldAlert, UserPlus, Users } from "lucide-react";
import { Button, GlassCard, Input, Select } from "@/components/primitives";
import { SectionHeading } from "@/components/SectionHeading";
import { createPlatformUser } from "@/api";
import { toast } from "@/store/useToast";

type RoleType = "Student" | "Mentor" | "HOD";

export default function AdminCreateUsers() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<RoleType>("Student");

  // Form states
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Student specific details
  const [usn, setUsn] = useState("");
  const [department, setDepartment] = useState("CSE");
  const [semester, setSemester] = useState("1");
  const [studentMobile, setStudentMobile] = useState("");
  const [parentMobile, setParentMobile] = useState("");
  const [parentEmail, setParentEmail] = useState("");

  // Mentor specific details
  const [mentorMobile, setMentorMobile] = useState("");
  const [maxMentees, setMaxMentees] = useState("20");

  // HOD specific details
  const [hodDepartment, setHodDepartment] = useState("CSE");

  function resetForm() {
    setFullName("");
    setEmail("");
    setUsn("");
    setDepartment("CSE");
    setSemester("1");
    setStudentMobile("");
    setParentMobile("");
    setParentEmail("");
    setMentorMobile("");
    setMaxMentees("20");
    setHodDepartment("CSE");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!fullName.trim() || !email.trim()) {
      setError("Name and Email are required.");
      return;
    }

    if (!email.toLowerCase().endsWith("@mitwpu.edu.in")) {
      setError("Only @mitwpu.edu.in email addresses are permitted.");
      return;
    }

    if (activeTab === "Student") {
      if (!usn.trim()) {
        setError("PRN Number is required for students.");
        return;
      }
      if (!/^\d{10}$/.test(usn.trim())) {
        setError("PRN Number must be exactly a 10-digit number.");
        return;
      }
    }

    setLoading(true);

    const payload: any = {
      full_name: fullName.trim(),
      email: email.trim().toLowerCase(),
      role: activeTab,
    };

    if (activeTab === "Student") {
      payload.usn = usn.trim();
      payload.department = department.trim();
      payload.semester = parseInt(semester) || 1;
      if (studentMobile.trim()) payload.student_mobile = studentMobile.trim();
      if (parentMobile.trim()) payload.parent_mobile = parentMobile.trim();
      if (parentEmail.trim()) payload.parent_email = parentEmail.trim();
    } else if (activeTab === "Mentor") {
      payload.department = department.trim();
      if (mentorMobile.trim()) payload.mobile_no = mentorMobile.trim();
      payload.max_mentees = parseInt(maxMentees) || 20;
    } else if (activeTab === "HOD") {
      payload.department = hodDepartment.trim();
    }

    try {
      await createPlatformUser(payload);
      toast.success(`${activeTab} registered successfully!`);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register user.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<ArrowLeft size={16} />}
          onClick={() => navigate("/app/admin")}
        >
          Back to Dashboard
        </Button>
      </div>

      <SectionHeading
        title="Direct User Registration"
        description="Register a new user directly in the system. The user's default password will be set to 'test123'."
      />

      {/* Tabs list */}
      <div className="flex border-b border-ink/8">
        {(["Student", "Mentor", "HOD"] as RoleType[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
              setActiveTab(tab);
              setError(null);
            }}
            className={`px-6 py-3 text-body font-medium transition-colors border-b-2 ${
              activeTab === tab
                ? "border-azure-500 text-azure-600"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            <span className="flex items-center gap-2">
              {tab === "Student" && <GraduationCap size={16} />}
              {tab === "Mentor" && <Users size={16} />}
              {tab === "HOD" && <ShieldAlert size={16} />}
              {tab}
            </span>
          </button>
        ))}
      </div>

      <GlassCard className="max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Full Name"
              placeholder="Full Name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={loading}
              required
            />
            <Input
              label="Email Address"
              type="email"
              placeholder="Email Address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
            />

            {/* Student specific fields */}
            {activeTab === "Student" && (
              <>
                <Input
                  label="PRN Number"
                  placeholder="10-digit PRN"
                  value={usn}
                  onChange={(e) => setUsn(e.target.value)}
                  disabled={loading}
                  required
                />
                <Select
                  label="Department"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  disabled={loading}
                >
                  <option value="CSE">Computer Science (CSE)</option>
                  <option value="ECE">Electronics (ECE)</option>
                  <option value="MECH">Mechanical (MECH)</option>
                  <option value="CIVIL">Civil (CIVIL)</option>
                </Select>
                <Select
                  label="Semester"
                  value={semester}
                  onChange={(e) => setSemester(e.target.value)}
                  disabled={loading}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => (
                    <option key={sem} value={sem}>
                      Semester {sem}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Student Mobile (Optional)"
                  placeholder="e.g. +91 98765 43210"
                  value={studentMobile}
                  onChange={(e) => setStudentMobile(e.target.value)}
                  disabled={loading}
                />
                <Input
                  label="Parent Mobile (Optional)"
                  placeholder="e.g. +91 98765 43210"
                  value={parentMobile}
                  onChange={(e) => setParentMobile(e.target.value)}
                  disabled={loading}
                />
                <Input
                  label="Parent Email (Optional)"
                  type="email"
                  placeholder="e.g. parent@email.com"
                  value={parentEmail}
                  onChange={(e) => setParentEmail(e.target.value)}
                  disabled={loading}
                />
              </>
            )}

            {/* Mentor specific fields */}
            {activeTab === "Mentor" && (
              <>
                <Select
                  label="Department"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  disabled={loading}
                >
                  <option value="CSE">Computer Science (CSE)</option>
                  <option value="ECE">Electronics (ECE)</option>
                  <option value="MECH">Mechanical (MECH)</option>
                  <option value="CIVIL">Civil (CIVIL)</option>
                </Select>
                <Input
                  label="Max Mentees"
                  type="number"
                  placeholder="e.g. 20"
                  value={maxMentees}
                  onChange={(e) => setMaxMentees(e.target.value)}
                  disabled={loading}
                />
                <div className="sm:col-span-2">
                  <Input
                    label="Mobile Number (Optional)"
                    placeholder="e.g. +91 98765 43210"
                    value={mentorMobile}
                    onChange={(e) => setMentorMobile(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </>
            )}

            {/* HOD specific fields */}
            {activeTab === "HOD" && (
              <div className="sm:col-span-2">
                <Select
                  label="Department"
                  value={hodDepartment}
                  onChange={(e) => setHodDepartment(e.target.value)}
                  disabled={loading}
                >
                  <option value="CSE">Computer Science (CSE)</option>
                  <option value="ECE">Electronics (ECE)</option>
                  <option value="MECH">Mechanical (MECH)</option>
                  <option value="CIVIL">Civil (CIVIL)</option>
                </Select>
              </div>
            )}
          </div>

          {error && <p className="text-caption text-signal-coral font-medium">{error}</p>}

          <div className="flex justify-end gap-3 border-t border-ink/8 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={resetForm}
              disabled={loading}
            >
              Reset
            </Button>
            <Button
              type="submit"
              disabled={loading}
              iconLeft={<UserPlus size={18} />}
            >
              {loading ? "Registering..." : `Register ${activeTab}`}
            </Button>
          </div>
        </form>
      </GlassCard>
    </div>
  );
}
