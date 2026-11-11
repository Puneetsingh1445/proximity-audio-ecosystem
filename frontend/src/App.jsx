import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AudioLines,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Headphones,
  Home,
  LogOut,
  MapPin,
  MessageCircle,
  Mic,
  MicOff,
  Radio,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  X,
} from "lucide-react";
import "./App.css";
import OfficeCanvas from "./components/OfficeCanvas.jsx";

// ── Static sample data (clearly labelled as demo) ────────────────────────────
const initialPeople = [
  { id: 1, name: "Aarav Mehta",    initials: "AM", color: "blue",   distance: "12 m", status: "In an audio room" },
  { id: 2, name: "Priya Shah",     initials: "PS", color: "purple", distance: "28 m", status: "Available"        },
  { id: 3, name: "Rohan Kulkarni", initials: "RK", color: "orange", distance: "45 m", status: "Listening"        },
  { id: 4, name: "Ananya Rao",     initials: "AR", color: "green",  distance: "68 m", status: "Available"        },
];

const initialRooms = [
  { id: 1, name: "Campus Conversations", category: "Community",  people: 8,  color: "blue"   },
  { id: 2, name: "Music & Chill",         category: "Music",       people: 5,  color: "purple" },
  { id: 3, name: "Tech Talk",             category: "Technology",  people: 12, color: "orange" },
];

const initialMessages = [
  { id: 1, from: "Priya", text: "Hey! Anyone around for a quick chat?",        mine: false },
  { id: 2, from: "You",   text: "Hey! Yes, I'm here.",                          mine: true  },
  { id: 3, from: "Priya", text: "Want to join the Campus Conversations room?", mine: false },
];

const navigation = [
  { id: "office",   label: "Office Map",    icon: MapPin       },
  { id: "overview", label: "Overview",      icon: Home         },
  { id: "nearby",   label: "Nearby people", icon: Users        },
  { id: "rooms",    label: "Audio rooms",   icon: Headphones   },
  { id: "chat",     label: "Messages",      icon: MessageCircle},
  { id: "settings", label: "Settings",      icon: Settings     },
];

// ── Password strength helper ──────────────────────────────────────────────────
function getPasswordStrength(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8)            s++;
  if (pw.length >= 12)           s++;
  if (/[A-Z]/.test(pw))         s++;
  if (/[0-9]/.test(pw))         s++;
  if (/[^A-Za-z0-9]/.test(pw))  s++;
  return Math.min(s, 4);
}

// ── Shared micro-components ───────────────────────────────────────────────────
function Avatar({ person, small = false }) {
  return (
    <div className={`avatar avatar-${person.color || "blue"} ${small ? "avatar-small" : ""}`}>
      {person.initials}
    </div>
  );
}

function SectionTitle({ eyebrow, title, description, action }) {
  return (
    <div className="section-title">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// ── Inline styles scoped to the auth card ────────────────────────────────────
const A = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 24,
    background: "#F7F9FC",
    fontFamily: "DM Sans, system-ui, sans-serif",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    padding: "36px 32px",
    borderRadius: 20,
    background: "#FFFFFF",
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.04), 0 20px 60px rgba(25,35,55,0.09)",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
  },
  brandMark: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 28,
  },
  brandIcon: {
    width: 44,
    height: 44,
    display: "grid",
    placeItems: "center",
    borderRadius: 13,
    background: "linear-gradient(135deg,#5e8bff,#3561db)",
    color: "#fff",
    boxShadow: "0 4px 14px rgba(65,105,225,0.32)",
  },
  brandName: {
    fontFamily: "Plus Jakarta Sans, sans-serif",
    fontWeight: 800,
    fontSize: 16,
    color: "#172033",
    letterSpacing: "-0.4px",
  },
  eyebrow: {
    color: "#718096",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1.3,
    margin: "0 0 6px",
    textTransform: "uppercase",
  },
  title: {
    color: "#172033",
    fontSize: 26,
    fontFamily: "Plus Jakarta Sans, sans-serif",
    fontWeight: 800,
    letterSpacing: "-0.8px",
    margin: "0 0 6px",
  },
  subtitle: { color: "#718096", margin: "0 0 24px", fontSize: 14, lineHeight: 1.6 },
  label: {
    display: "block",
    color: "#273248",
    fontWeight: 600,
    fontSize: 13,
    margin: "14px 0 7px",
  },
  inputWrap: { position: "relative" },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 13px",
    border: "1.5px solid #E8EDF4",
    borderRadius: 10,
    fontSize: 14,
    color: "#172033",
    background: "#FAFBFE",
    outline: "none",
    transition: "border-color 180ms, box-shadow 180ms",
  },
  inputPw: {
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 42px 12px 13px",
    border: "1.5px solid #E8EDF4",
    borderRadius: 10,
    fontSize: 14,
    color: "#172033",
    background: "#FAFBFE",
    outline: "none",
    transition: "border-color 180ms, box-shadow 180ms",
  },
  pwToggle: {
    position: "absolute",
    right: 11,
    top: "50%",
    transform: "translateY(-50%)",
    border: 0,
    background: "transparent",
    color: "#94A3B8",
    cursor: "pointer",
    padding: 4,
    display: "flex",
    alignItems: "center",
    borderRadius: 6,
  },
  pwStrengthWrap: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    marginTop: 7,
  },
  pwStrengthBar: {
    flex: 1,
    height: 3,
    borderRadius: 10,
    transition: "background 300ms",
  },
  pwStrengthLabel: {
    fontSize: 10,
    fontWeight: 700,
    whiteSpace: "nowrap",
    marginLeft: 4,
    minWidth: 36,
  },
  error: {
    color: "#B42318",
    background: "#FEF3F2",
    padding: "10px 12px",
    borderRadius: 9,
    fontSize: 13,
    border: "1px solid #FEE2E2",
    lineHeight: 1.5,
  },
  success: {
    color: "#0d6b3d",
    background: "#ecfdf5",
    border: "1px solid #A7F3D0",
    padding: "10px 12px",
    borderRadius: 9,
    fontSize: 13,
  },
  submit: {
    marginTop: 20,
    border: 0,
    borderRadius: 10,
    padding: "13px 0",
    background: "linear-gradient(135deg,#5578ea,#3156d5)",
    color: "#FFFFFF",
    fontWeight: 700,
    fontSize: 15,
    cursor: "pointer",
    width: "100%",
    letterSpacing: "-0.3px",
    boxShadow: "0 4px 14px rgba(65,105,225,0.30)",
    transition: "opacity 180ms, transform 120ms",
  },
  note: {
    color: "#7B8495",
    fontSize: 12.5,
    lineHeight: 1.5,
    marginTop: 18,
    textAlign: "center",
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#4169E1",
    fontWeight: 700,
    fontSize: 12.5,
    cursor: "pointer",
    padding: 0,
    textDecoration: "underline",
    textUnderlineOffset: 2,
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
//  Main App component
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {

  // ── Auth state ──────────────────────────────────────────────────────────────
  const [auth, setAuth] = useState(() => {
    try {
      const raw = localStorage.getItem("proxispeak:auth");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.token && parsed?.user?.id) return parsed;
      return null;
    } catch {
      return null;
    }
  });
  const [authLoading, setAuthLoading] = useState(true);
  const [authView,    setAuthView]    = useState("login"); // "login" | "register"

  // ── Login form ──────────────────────────────────────────────────────────────
  const [loginEmail,    setLoginEmail]    = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError,    setLoginError]    = useState("");
  const [loginBusy,     setLoginBusy]     = useState(false);
  const [showLoginPw,   setShowLoginPw]   = useState(false);

  // ── Register form ───────────────────────────────────────────────────────────
  const [regName,     setRegName]     = useState("");
  const [regEmail,    setRegEmail]    = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regError,    setRegError]    = useState("");
  const [regBusy,     setRegBusy]     = useState(false);
  const [regSuccess,  setRegSuccess]  = useState("");
  const [showRegPw,   setShowRegPw]   = useState(false);

  // ── Dashboard state ─────────────────────────────────────────────────────────
  const [activePage,      setActivePage]      = useState("overview");
  const [people, setPeople]                  = useState(initialPeople);
  const [nearbyLoading, setNearbyLoading]     = useState(false);
  const [nearbyError, setNearbyError]         = useState("");
  const [liveOfficePositions, setLiveOfficePositions] = useState({
    myPosition: null,
    players: [],
    connectionStatus: "disconnected",
  });
  const hasConnectedOfficeRef = useRef(false);
  const [rooms,           setRooms]           = useState(initialRooms);
  const [messages,        setMessages]        = useState(initialMessages);
  const [selectedPerson,  setSelectedPerson]  = useState(null);
  const [selectedRoom,    setSelectedRoom]    = useState(null);
  const [search,          setSearch]          = useState("");
  const [chatInput,       setChatInput]       = useState("");
  const [roomSearch,      setRoomSearch]      = useState("");
  const [micEnabled,      setMicEnabled]      = useState(false);
  const [muted,           setMuted]           = useState(true);
  const [notifications,   setNotifications]   = useState(true);
  const [profileName,     setProfileName]     = useState("Sam");
  const [profileSaving,   setProfileSaving]   = useState(false);
  const [profileError,    setProfileError]    = useState("");

  const [permission,          setPermission]          = useState("idle");
  const [micPermission,       setMicPermission]       = useState("idle");
  const [showNotifications,   setShowNotifications]   = useState(false);
  const [showProfileMenu,     setShowProfileMenu]     = useState(false);
  const [connectedPeople,     setConnectedPeople]     = useState([]);
  const [notice,              setNotice]              = useState("");

  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5055";

  // Load real nearby users from the authenticated backend API.
  useEffect(() => {
    if (activePage !== "nearby" || !auth?.token) return undefined;

    let cancelled = false;

    async function fetchNearbyUsers() {
      setNearbyLoading(true);
      setNearbyError("");

      try {
        const response = await fetch(
          `${API_URL}/api/users/nearby?radius=300`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${auth.token}`,
            },
          }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.message || "Could not load nearby users.");
        }

        if (!Array.isArray(data.users)) {
          throw new Error("The nearby users response was not in the expected format.");
        }

        const myPosition = data.myPosition;
        const colors = ["blue", "purple", "orange", "green"];

        const livePeople = data.users
          // Do not show the currently signed-in user in their own nearby list.
          .filter((user) => String(user.id) !== String(auth.user.id))
          .map((user, index) => {
            const name = String(user.name || "ProxiSpeak user");
            const initials = name
              .trim()
              .split(/\s+/)
              .map((part) => part[0])
              .join("")
              .toUpperCase()
              .slice(0, 2) || "PS";

            const hasPositions =
              Array.isArray(myPosition) &&
              myPosition.length === 2 &&
              Array.isArray(user.position) &&
              user.position.length === 2 &&
              myPosition.every(Number.isFinite) &&
              user.position.every(Number.isFinite);

            const distance = hasPositions
              ? `${Math.round(
                  Math.hypot(
                    user.position[0] - myPosition[0],
                    user.position[1] - myPosition[1]
                  )
                )} px`
              : "Unknown";

            return {
              id: String(user.id),
              name,
              initials,
              color: colors[index % colors.length],
              distance,
              status: "Checking presence...",
              presence: "unknown",
              position: user.position,
            };
          });

        if (!cancelled) {
          setPeople(livePeople);
        }
      } catch (error) {
        if (!cancelled) {
          setNearbyError(error.message || "Could not load nearby users.");
        }
      } finally {
        if (!cancelled) {
          setNearbyLoading(false);
        }
      }
    }

    fetchNearbyUsers();

    return () => {
      cancelled = true;
    };
  }, [activePage, auth?.token, auth?.user?.id, API_URL]);

  // Update Online/Offline presence and Nearby/Away proximity from Socket.IO.
  useEffect(() => {
    const { myPosition, players, connectionStatus } = liveOfficePositions;
    const NEARBY_RADIUS = 300;

    if (connectionStatus === "connected") {
      hasConnectedOfficeRef.current = true;
    }

    // Do not mark everyone Offline before the first successful connection.
    if (!hasConnectedOfficeRef.current) {
      return;
    }

    // After a previously successful connection drops, mark all listed users Offline.
    if (connectionStatus !== "connected") {
      setPeople((currentPeople) =>
        currentPeople.map((person) => ({
          ...person,
          status: "Offline",
          presence: "offline",
        }))
      );
      return;
    }

    if (
      !myPosition ||
      !Number.isFinite(myPosition.x) ||
      !Number.isFinite(myPosition.y) ||
      !Array.isArray(players)
    ) {
      return;
    }

    const livePlayerMap = new Map(
      players.map((player) => [String(player.id), player])
    );

    setPeople((currentPeople) =>
      currentPeople.map((person) => {
        const livePlayer = livePlayerMap.get(String(person.id));

        if (!livePlayer) {
          return {
            ...person,
            status: "Offline",
            presence: "offline",
          };
        }

        if (
          !Number.isFinite(livePlayer.x) ||
          !Number.isFinite(livePlayer.y)
        ) {
          return {
            ...person,
            status: "Online",
            presence: "online",
          };
        }

        const distance = Math.round(
          Math.hypot(
            livePlayer.x - myPosition.x,
            livePlayer.y - myPosition.y
          )
        );
        const proximity = distance <= NEARBY_RADIUS ? "Nearby" : "Away";

        return {
          ...person,
          position: [livePlayer.x, livePlayer.y],
          distance: `${distance} px`,
          status: `Online · ${proximity}`,
          presence: "online",
        };
      })
    );
  }, [liveOfficePositions]);

  // Password strength
  const pwStrength      = getPasswordStrength(regPassword);
  const pwStrengthLabel = ["", "Weak", "Fair", "Good", "Strong"][pwStrength];
  const pwStrengthColor = ["", "#ef4444", "#f59e0b", "#3b82f6", "#22c55e"][pwStrength];

  // Resolve auth from localStorage before first paint
  useEffect(() => { setAuthLoading(false); }, []);

  // Sync profile name from stored auth
  useEffect(() => {
    if (auth?.user?.name) setProfileName(auth.user.name);
  }, [auth]);

  // ── Handlers (API + logic) — unchanged from original ───────────────────────
  async function handleLogin(event) {
    event.preventDefault();
    setLoginError("");
    if (!loginEmail.trim() || !loginPassword) {
      setLoginError("Enter your email and password.");
      return;
    }
    setLoginBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/users/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      const data = await response.json();
      if (!response.ok || !data.token || !data.user?.id) {
        throw new Error(data.message || "Login failed. Check your credentials.");
      }
      const savedAuth = { token: data.token, user: data.user };
      localStorage.setItem("proxispeak:auth", JSON.stringify(savedAuth));
      setAuth(savedAuth);
      setProfileName(data.user.name || "User");
      setActivePage("office");
      setLoginPassword("");
    } catch (error) {
      setLoginError(error.message || "Unable to connect to the backend. Check that it is running.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    setRegError("");
    setRegSuccess("");
    if (!regName.trim())   { setRegError("Please enter your name.");          return; }
    if (!regEmail.trim())  { setRegError("Please enter your email address."); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(regEmail.trim().toLowerCase())) {
      setRegError("Please enter a valid email address.");
      return;
    }
    if (!regPassword)             { setRegError("Please enter a password.");                       return; }
    if (regPassword.length < 8)   { setRegError("Password must be at least 8 characters.");        return; }
    setRegBusy(true);
    try {
      const registerResponse = await fetch(`${API_URL}/api/users/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: regName.trim(), email: regEmail.trim(), password: regPassword }),
      });
      const registerData = await registerResponse.json();
      if (!registerResponse.ok || !registerData.success) {
        throw new Error(registerData.message || "Registration failed. Please try again.");
      }
      const loginResponse = await fetch(`${API_URL}/api/users/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: regEmail.trim(), password: regPassword }),
      });
      const loginData = await loginResponse.json();
      if (!loginResponse.ok || !loginData.token || !loginData.user?.id) {
        setRegSuccess("Account created! Please sign in with your new credentials.");
        setAuthView("login");
        setLoginEmail(regEmail.trim());
        setRegName(""); setRegEmail(""); setRegPassword("");
        return;
      }
      const savedAuth = { token: loginData.token, user: loginData.user };
      localStorage.setItem("proxispeak:auth", JSON.stringify(savedAuth));
      setAuth(savedAuth);
      setProfileName(loginData.user.name || "User");
      setActivePage("office");
      setRegName(""); setRegEmail(""); setRegPassword("");
    } catch (error) {
      setRegError(error.message || "Unable to connect to the backend. Make sure it is running.");
    } finally {
      setRegBusy(false);
    }
  }

  async function handleSaveProfile() {
    const name = profileName.trim();
    if (!name)        { setProfileError("Name cannot be empty.");    return; }
    if (!auth?.token) { setProfileError("Please sign in again.");    return; }
    setProfileSaving(true);
    setProfileError("");
    try {
      const response = await fetch(`${API_URL}/api/users/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.user) {
        throw new Error(data.message || "Profile update failed.");
      }
      const updatedAuth = { ...auth, user: { ...auth.user, ...data.user } };
      localStorage.setItem("proxispeak:auth", JSON.stringify(updatedAuth));
      setAuth(updatedAuth);
      setProfileName(data.user.name);
      showNotice("Profile updated successfully!");
    } catch (error) {
      setProfileError(error.message || "Could not update your profile.");
    } finally {
      setProfileSaving(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem("proxispeak:auth");
    setAuth(null);
    setLoginEmail(""); setLoginPassword(""); setLoginError("");
    setActivePage("overview");
    setProfileName("Sam");
    setShowProfileMenu(false);
    window.setTimeout(() => showNotice("You have been signed out."), 0);
  }

  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  };

  async function enableLocation() {
    if (!navigator.geolocation) { setPermission("unsupported"); return; }
    setPermission("loading");
    navigator.geolocation.getCurrentPosition(
      () => {
        setPermission("granted");
        showNotice("Location access granted. Live discovery needs backend integration.");
      },
      (error) => { setPermission(error.code === 1 ? "denied" : "error"); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }

  async function enableMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) { setMicPermission("unsupported"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicPermission("granted");
      showNotice("Microphone permission granted.");
    } catch {
      setMicPermission("denied");
      showNotice("Microphone access was not granted.");
    }
  }

  function connectPerson(person) {
    setConnectedPeople((current) =>
      current.includes(person.id)
        ? current.filter((id) => id !== person.id)
        : [...current, person.id]
    );
    setSelectedPerson(null);
    showNotice(
      connectedPeople.includes(person.id)
        ? `Removed ${person.name} from your connections.`
        : `Demo connection added for ${person.name}.`
    );
  }

  function joinRoom(room) {
    setSelectedRoom(room);
    setActivePage("rooms");
  }

  function sendMessage(event) {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    setMessages((current) => [...current, { id: Date.now(), from: "You", text, mine: true }]);
    setChatInput("");
  }

  function addRoom() {
    const name = window.prompt("Enter a name for your audio room:");
    if (!name?.trim()) return;
    const room = { id: Date.now(), name: name.trim(), category: "My room", people: 1, color: "green" };
    setRooms((current) => [room, ...current]);
    setSelectedRoom(room);
    showNotice("Demo room created. Live audio needs a backend or real-time audio service.");
  }

  const filteredPeople = people.filter((person) =>
    `${person.name} ${person.status}`.toLowerCase().includes(search.toLowerCase())
  );
  const filteredRooms = rooms.filter((room) =>
    `${room.name} ${room.category}`.toLowerCase().includes(roomSearch.toLowerCase())
  );

  const pageTitle = navigation.find((item) => item.id === activePage)?.label || "Overview";

  // ── Render helpers ──────────────────────────────────────────────────────────
  function renderPerson(person) {
    return (
      <div className="person-row" key={person.id}>
        <div className="person-identity">
          <div className="avatar-wrap">
            <Avatar person={person} />
            <span
              className={`presence ${
                person.presence === "online" ? "presence-online" : ""
              }`}
            />
          </div>
          <div className="person-copy">
            <strong>{person.name}</strong>
            <span>{person.status}</span>
          </div>
        </div>
        <span className="distance"><MapPin size={13} /> {person.distance}</span>
        <button className="button button-outline button-small" onClick={() => setSelectedPerson(person)}>
          View
        </button>
      </div>
    );
  }

  function renderRoom(room) {
    return (
      <div className="room-card" key={room.id}>
        <div className={`room-art room-art-${room.color}`}>
          <AudioLines size={27} />
          <span className="live-label"><span /> ROOM</span>
        </div>
        <div className="room-content">
          <span className="room-category">{room.category}</span>
          <h3>{room.name}</h3>
          <p className="muted"><Users size={14} /> {room.people} participants (demo)</p>
          <button className="button button-primary room-join" onClick={() => joinRoom(room)}>
            Join room <ChevronRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Auth loading splash
  // ═══════════════════════════════════════════════════════════════════════════
  if (authLoading) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-logo">
          <span className="brand-icon"><AudioLines size={22} /></span>
        </div>
        <div className="auth-loading-spinner" />
        <p className="auth-loading-text">Loading ProxiSpeak…</p>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Auth screens (login / register)
  // ═══════════════════════════════════════════════════════════════════════════
  if (!auth) {
    return (
      <div style={A.page}>
        <div style={A.card}>

          {/* Brand mark */}
          <div style={A.brandMark}>
            <div style={A.brandIcon}><AudioLines size={22} /></div>
            <span style={A.brandName}>ProxiSpeak</span>
          </div>

          {/* ── LOGIN ─────────────────────────────────────────────────────── */}
          {authView === "login" && (
            <>
              <p style={A.eyebrow}>Welcome back</p>
              <h1 style={A.title}>Sign in</h1>
              <p style={A.subtitle}>Enter your registered email and password to continue.</p>

              {regSuccess && (
                <p style={{ ...A.success, marginBottom: 14 }} role="status">{regSuccess}</p>
              )}

              <form onSubmit={handleLogin} noValidate>
                <label style={A.label} htmlFor="login-email">Email address</label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  className="auth-input"
                  style={A.input}
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={loginBusy}
                  required
                />

                <label style={A.label} htmlFor="login-password">Password</label>
                <div style={A.inputWrap}>
                  <input
                    id="login-password"
                    type={showLoginPw ? "text" : "password"}
                    autoComplete="current-password"
                    className="auth-input"
                    style={A.inputPw}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    disabled={loginBusy}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPw((v) => !v)}
                    style={A.pwToggle}
                    aria-label={showLoginPw ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showLoginPw ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>

                {loginError && (
                  <p style={{ ...A.error, marginTop: 12 }} role="alert">{loginError}</p>
                )}

                <button
                  type="submit"
                  style={{ ...A.submit, opacity: loginBusy ? 0.7 : 1 }}
                  disabled={loginBusy}
                >
                  {loginBusy ? "Signing in…" : "Sign in"}
                </button>
              </form>

              <p style={A.note}>
                Don&apos;t have an account?{" "}
                <button
                  style={A.linkBtn}
                  onClick={() => { setLoginError(""); setRegError(""); setRegSuccess(""); setAuthView("register"); }}
                >
                  Create one
                </button>
              </p>
            </>
          )}

          {/* ── REGISTER ──────────────────────────────────────────────────── */}
          {authView === "register" && (
            <>
              <p style={A.eyebrow}>Get started</p>
              <h1 style={A.title}>Create account</h1>
              <p style={A.subtitle}>Fill in the details below to get started with ProxiSpeak.</p>

              <form onSubmit={handleRegister} noValidate>
                <label style={A.label} htmlFor="reg-name">Full name</label>
                <input
                  id="reg-name"
                  type="text"
                  autoComplete="name"
                  className="auth-input"
                  style={A.input}
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="Jane Smith"
                  disabled={regBusy}
                  required
                />

                <label style={A.label} htmlFor="reg-email">Email address</label>
                <input
                  id="reg-email"
                  type="email"
                  autoComplete="email"
                  className="auth-input"
                  style={A.input}
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={regBusy}
                  required
                />

                <label style={A.label} htmlFor="reg-password">Password</label>
                <div style={A.inputWrap}>
                  <input
                    id="reg-password"
                    type={showRegPw ? "text" : "password"}
                    autoComplete="new-password"
                    className="auth-input"
                    style={A.inputPw}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    disabled={regBusy}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegPw((v) => !v)}
                    style={A.pwToggle}
                    aria-label={showRegPw ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showRegPw ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>

                {/* Password strength bars */}
                {regPassword && (
                  <div style={A.pwStrengthWrap}>
                    {[1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        style={{
                          ...A.pwStrengthBar,
                          background: i <= pwStrength ? pwStrengthColor : "#E8EDF4",
                        }}
                      />
                    ))}
                    {pwStrengthLabel && (
                      <span style={{ ...A.pwStrengthLabel, color: pwStrengthColor }}>
                        {pwStrengthLabel}
                      </span>
                    )}
                  </div>
                )}

                {regError && (
                  <p style={{ ...A.error, marginTop: 12 }} role="alert">{regError}</p>
                )}

                <button
                  type="submit"
                  style={{ ...A.submit, opacity: regBusy ? 0.7 : 1 }}
                  disabled={regBusy}
                >
                  {regBusy ? "Creating account…" : "Create account"}
                </button>
              </form>

              <p style={A.note}>
                Already have an account?{" "}
                <button
                  style={A.linkBtn}
                  onClick={() => { setRegError(""); setLoginError(""); setAuthView("login"); }}
                >
                  Sign in instead
                </button>
              </p>
            </>
          )}
        </div>

        {notice && (
          <div
            className="toast"
            role="status"
            style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)" }}
          >
            <Check size={17} /> {notice}
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Authenticated dashboard
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="app-shell">

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <button className="brand" onClick={() => setActivePage("overview")}>
          <span className="brand-icon"><AudioLines size={24} /></span>
          <span>ProxiSpeak<small>Connect nearby</small></span>
        </button>

        <p className="nav-heading">WORKSPACE</p>
        <nav className="nav-list">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${activePage === id ? "nav-active" : ""}`}
              onClick={() => setActivePage(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "chat" && <span className="nav-count">3</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={19} />
            <div>
              <strong>Your space, your control</strong>
              <p>Manage permissions anytime.</p>
            </div>
          </div>
          <button className="profile-button" onClick={() => setActivePage("settings")}>
            <div className="avatar avatar-profile">{profileName.slice(0, 2).toUpperCase()}</div>
            <div className="profile-copy">
              <strong>{profileName}</strong>
              <span>My profile</span>
            </div>
            <Settings size={17} />
          </button>
          <button
            className="button button-outline button-small"
            onClick={handleLogout}
            style={{ width: "100%", marginTop: 10 }}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main panel ──────────────────────────────────────────────────────── */}
      <main className="main-panel">

        {/* Top bar */}
        <header className="topbar">
          <div className="mobile-brand"><AudioLines size={23} /> ProxiSpeak</div>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} /> <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-actions">
            <span className="connection-status">
              <span /> {auth?.user?.name ? `Signed in as ${auth.user.name}` : "Signed in"}
            </span>

            {/* Notifications */}
            <div className="notification-wrap">
              <button
                className="icon-button"
                aria-label="Notifications"
                onClick={() => { setShowNotifications(!showNotifications); setShowProfileMenu(false); }}
              >
                <Bell size={19} />
              </button>
              {showNotifications && (
                <>
                  <div className="dropdown-backdrop" onClick={() => setShowNotifications(false)} />
                  <div className="notification-popover">
                    <strong>Notifications</strong>
                    <p>{notifications ? "You're all caught up." : "Notifications are turned off in settings."}</p>
                    <button
                      className="text-button"
                      onClick={() => { setShowNotifications(false); setActivePage("settings"); }}
                    >
                      Open settings
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Profile menu */}
            <div className="profile-menu-wrap">
              <button
                className="profile-trigger"
                onClick={() => { setShowProfileMenu(!showProfileMenu); setShowNotifications(false); }}
                aria-label="Profile menu"
                aria-expanded={showProfileMenu}
              >
                <div className="avatar avatar-profile top-avatar">
                  {profileName.slice(0, 2).toUpperCase()}
                </div>
                <ChevronDown size={14} className={showProfileMenu ? "chevron-rotated" : ""} />
              </button>
              {showProfileMenu && (
                <>
                  <div className="dropdown-backdrop" onClick={() => setShowProfileMenu(false)} />
                  <div className="profile-dropdown">
                    <div className="profile-dropdown-header">
                      <strong>{profileName}</strong>
                      <span>{auth?.user?.email || "ProxiSpeak user"}</span>
                    </div>
                    <button
                      className="profile-dropdown-item"
                      onClick={() => { setShowProfileMenu(false); setActivePage("settings"); }}
                    >
                      <Settings size={15} /> Settings
                    </button>
                    <div className="profile-dropdown-divider" />
                    <button
                      className="profile-dropdown-item profile-dropdown-danger"
                      onClick={handleLogout}
                    >
                      <LogOut size={15} /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="page-content">

          {/* ── OFFICE MAP ──────────────────────────────────────────────────── */}
          <div
            style={{
              display: activePage === "office" ? "block" : "none",
            }}
          >
            <OfficeCanvas
              displayName={auth?.user?.name || profileName}
              userId={auth?.user?.id}
              token={auth?.token}
              onLivePositionsChange={setLiveOfficePositions}
            />
          </div>

          {/* ── OVERVIEW ────────────────────────────────────────────────────── */}
          {activePage === "overview" && (
            <>
              <div className="welcome-row">
                <div>
                  <p className="eyebrow">YOUR AUDIO COMMUNITY</p>
                  <h1>Good to see you, {profileName} <span>✦</span></h1>
                  <p className="muted">Discover people, join conversations, and connect in real time.</p>
                </div>
                <button className="button button-primary" onClick={() => setActivePage("nearby")}>
                  <Users size={17} /> Explore nearby
                </button>
              </div>

              <div className="hero-banner">
                <div className="hero-copy">
                  <span className="hero-tag"><Radio size={14} /> PROXIMITY DISCOVERY</span>
                  <h2>Good conversations<br />are closer than you think.</h2>
                  <p>Find people around you and make every nearby moment more connected.</p>
                  <button className="button button-white" onClick={enableLocation}>
                    <MapPin size={17} />
                    {permission === "loading"
                      ? "Requesting access..."
                      : permission === "granted"
                      ? "Location enabled"
                      : "Enable location"}
                  </button>
                  {permission === "denied"      && <small className="hero-hint">Access denied. Check your browser&apos;s site permissions.</small>}
                  {permission === "unsupported" && <small className="hero-hint">Geolocation isn&apos;t supported by this browser.</small>}
                  {permission === "error"       && <small className="hero-hint">Couldn&apos;t get your location. Try again.</small>}
                </div>
                <div className="hero-visual" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="orbit orbit-three" />
                  <div className="orbit-center"><AudioLines size={32} /></div>
                  <div className="orbit-avatar orbit-avatar-one">A</div>
                  <div className="orbit-avatar orbit-avatar-two">P</div>
                  <div className="orbit-avatar orbit-avatar-three">R</div>
                </div>
              </div>

              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-icon stat-blue"><Users size={20} /></span>
                  <span className="stat-label">Nearby profiles</span>
                  <strong>{people.length}</strong>
                  <small>Sample profiles</small>
                </div>
                <div className="stat-card">
                  <span className="stat-icon stat-purple"><Headphones size={20} /></span>
                  <span className="stat-label">Audio rooms</span>
                  <strong>{rooms.length}</strong>
                  <small>Demo rooms available</small>
                </div>
                <div className="stat-card">
                  <span className="stat-icon stat-green"><Activity size={20} /></span>
                  <span className="stat-label">Your connections</span>
                  <strong>{connectedPeople.length}</strong>
                  <small>Local demo connections</small>
                </div>
              </div>

              <section className="content-section">
                <SectionTitle
                  eyebrow="DISCOVER"
                  title="People around you"
                  description="Sample profiles to preview the discovery experience."
                  action={
                    <button className="text-button" onClick={() => setActivePage("nearby")}>
                      View all <ChevronRight size={15} />
                    </button>
                  }
                />
                <div className="panel people-panel">{people.slice(0, 3).map(renderPerson)}</div>
              </section>

              <section className="content-section">
                <SectionTitle
                  eyebrow="TUNE IN"
                  title="Explore audio rooms"
                  description="Find a conversation that interests you."
                  action={
                    <button className="text-button" onClick={() => setActivePage("rooms")}>
                      All rooms <ChevronRight size={15} />
                    </button>
                  }
                />
                <div className="rooms-grid">{rooms.slice(0, 3).map(renderRoom)}</div>
              </section>
            </>
          )}

          {/* ── NEARBY PEOPLE ────────────────────────────────────────────────── */}
          {activePage === "nearby" && (
            <>
              <SectionTitle
                eyebrow="DISCOVERY"
                title="Nearby people"
                description="Registered users within the selected virtual-office radius."
              />
              <div className="permission-banner">
                <MapPin size={20} />
                <div>
                  <strong>Live nearby discovery</strong>
                  <p>
                    People and distances are loaded from your backend using virtual-office
                    canvas positions. Distances are shown in pixels, not GPS metres.
                  </p>
                </div>
              </div>
              <div className="toolbar">
                <div className="search-box">
                  <Search size={18} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search people or status..."
                  />
                </div>
                <span className="muted">{nearbyLoading ? "Loading..." : `${filteredPeople.length} profiles`}</span>
              </div>
              <div className="panel people-panel">
                {nearbyLoading ? (
                  <p className="empty-state">Loading nearby users...</p>
                ) : nearbyError ? (
                  <p className="empty-state" role="alert">{nearbyError}</p>
                ) : filteredPeople.length ? (
                  filteredPeople.map(renderPerson)
                ) : (
                  <p className="empty-state">
                    {search
                      ? "No matching users. Try a different search."
                      : "No other registered users were returned by the nearby API."}
                  </p>
                )}
              </div>
              <p className="footnote">
                <ShieldCheck size={15} /> User names and positions come from your backend. Distances are calculated from virtual-office canvas coordinates.
              </p>
            </>
          )}

          {/* ── AUDIO ROOMS ──────────────────────────────────────────────────── */}
          {activePage === "rooms" && (
            <>
              <SectionTitle
                eyebrow="LISTEN TOGETHER"
                title="Audio rooms"
                description="Explore rooms, preview controls, and create a local demo room."
                action={
                  <button className="button button-primary" onClick={addRoom}>
                    <AudioLines size={17} /> Create room
                  </button>
                }
              />
              <div className="toolbar">
                <div className="search-box">
                  <Search size={18} />
                  <input
                    value={roomSearch}
                    onChange={(e) => setRoomSearch(e.target.value)}
                    placeholder="Search audio rooms..."
                  />
                </div>
                <span className="muted">{filteredRooms.length} rooms</span>
              </div>
              <div className="rooms-grid">{filteredRooms.map(renderRoom)}</div>
              {filteredRooms.length === 0 && <p className="empty-state">No rooms match your search.</p>}

              {selectedRoom && (
                <section className="panel active-room">
                  <div className="active-room-heading">
                    <div>
                      <p className="eyebrow">NOW SELECTED</p>
                      <h2>{selectedRoom.name}</h2>
                      <p className="muted">Audio controls preview — live room audio is not connected.</p>
                    </div>
                    <button className="icon-button" aria-label="Close room" onClick={() => setSelectedRoom(null)}>
                      <X size={18} />
                    </button>
                  </div>
                  <div className="audio-visualizer">
                    {Array.from({ length: 35 }, (_, i) => (
                      <span key={i} style={{ "--bar": `${12 + ((i * 17 + 13) % 42)}px` }} />
                    ))}
                  </div>
                  <div className="audio-controls">
                    <button
                      className={`audio-control ${micEnabled ? "control-on" : ""}`}
                      onClick={() => setMicEnabled(!micEnabled)}
                    >
                      {micEnabled ? <Mic size={19} /> : <MicOff size={19} />}
                      <span>{micEnabled ? "Mic preview on" : "Mic off"}</span>
                    </button>
                    <button className="audio-control" onClick={() => setMuted(!muted)}>
                      {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
                      <span>{muted ? "Muted" : "Unmuted"}</span>
                    </button>
                    <button className="button button-outline" onClick={() => setSelectedRoom(null)}>
                      Leave preview
                    </button>
                  </div>
                  <p className="footnote">
                    These controls change the interface only. They don&apos;t publish audio or connect to other listeners.
                  </p>
                </section>
              )}
            </>
          )}

          {/* ── MESSAGES ─────────────────────────────────────────────────────── */}
          {activePage === "chat" && (
            <>
              <SectionTitle
                eyebrow="STAY CONNECTED"
                title="Messages"
                description="A local chat preview. Messages are not sent to other users."
              />
              <div className="chat-layout panel">
                <div className="chat-contact-list">
                  <h3>Conversations</h3>
                  <button className="chat-contact selected-contact">
                    <Avatar person={initialPeople[1]} small />
                    <span>
                      <strong>Priya Shah</strong>
                      <small>Demo conversation</small>
                    </span>
                    <span className="contact-dot" />
                  </button>
                  <p className="chat-disclaimer">This is sample content. Real conversations need backend messaging.</p>
                </div>
                <div className="chat-conversation">
                  <div className="chat-header">
                    <Avatar person={initialPeople[1]} small />
                    <div>
                      <strong>Priya Shah</strong>
                      <small><span className="presence-dot" /> Sample conversation</small>
                    </div>
                  </div>
                  <div className="message-list">
                    {messages.map((message) => (
                      <div className={`message ${message.mine ? "message-mine" : ""}`} key={message.id}>
                        <span>{message.from}</span>
                        <p>{message.text}</p>
                      </div>
                    ))}
                  </div>
                  <form className="chat-form" onSubmit={sendMessage}>
                    <input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Write a demo message..."
                      aria-label="Message"
                    />
                    <button className="button button-primary" type="submit" aria-label="Send message">
                      <Send size={17} />
                    </button>
                  </form>
                </div>
              </div>
            </>
          )}

          {/* ── SETTINGS ─────────────────────────────────────────────────────── */}
          {activePage === "settings" && (
            <>
              <SectionTitle
                eyebrow="YOUR ACCOUNT"
                title="Settings"
                description="Manage your profile, permissions, and app preferences."
              />
              <div className="settings-grid">

                {/* Profile */}
                <section className="panel settings-card">
                  <div className="settings-heading">
                    <span className="settings-icon"><Users size={20} /></span>
                    <div>
                      <h3>Your profile</h3>
                      <p className="muted">Choose how you appear in ProxiSpeak.</p>
                    </div>
                  </div>
                  <label className="field-label" htmlFor="profile-name">Display name</label>
                  <input
                    id="profile-name"
                    className="field-input"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    maxLength={30}
                    disabled={profileSaving}
                  />
                  {profileError && (
                    <p className="footnote" role="alert" style={{ color: "#B42318" }}>{profileError}</p>
                  )}
                  <button
                    type="button"
                    className="button button-primary button-small"
                    onClick={handleSaveProfile}
                    disabled={profileSaving}
                    style={{ marginTop: 12 }}
                  >
                    {profileSaving ? "Saving..." : "Save changes"}
                  </button>
                  <p className="footnote">Your display name is saved to your account.</p>
                </section>

                {/* Permissions */}
                <section className="panel settings-card">
                  <div className="settings-heading">
                    <span className="settings-icon"><ShieldCheck size={20} /></span>
                    <div>
                      <h3>Permissions</h3>
                      <p className="muted">Browser permissions are requested only when you ask.</p>
                    </div>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong><MapPin size={16} /> Location</strong>
                      <p>{permission === "granted" ? "Permission granted" : permission === "denied" ? "Permission denied" : "Not requested"}</p>
                    </div>
                    <button className="button button-outline button-small" onClick={enableLocation}>Request</button>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong><Mic size={16} /> Microphone</strong>
                      <p>{micPermission === "granted" ? "Permission granted" : micPermission === "denied" ? "Permission denied" : "Not requested"}</p>
                    </div>
                    <button className="button button-outline button-small" onClick={enableMicrophone}>Test access</button>
                  </div>
                  <p className="footnote">Microphone access is checked and immediately released. Live audio is not transmitted.</p>
                </section>

                {/* Preferences */}
                <section className="panel settings-card">
                  <div className="settings-heading">
                    <span className="settings-icon"><Bell size={20} /></span>
                    <div>
                      <h3>Preferences</h3>
                      <p className="muted">Customize your experience.</p>
                    </div>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>Notifications</strong>
                      <p>Show in-app notification status</p>
                    </div>
                    <button
                      className={`toggle ${notifications ? "toggle-on" : ""}`}
                      role="switch"
                      aria-checked={notifications}
                      aria-label="Toggle notifications"
                      onClick={() => setNotifications(!notifications)}
                    >
                      <span />
                    </button>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>Audio preview</strong>
                      <p>Start room previews muted</p>
                    </div>
                    <button
                      className={`toggle ${muted ? "toggle-on" : ""}`}
                      role="switch"
                      aria-checked={muted}
                      aria-label="Toggle muted preview"
                      onClick={() => setMuted(!muted)}
                    >
                      <span />
                    </button>
                  </div>
                </section>

                {/* Connection status */}
                <section className="panel settings-card">
                  <div className="settings-heading">
                    <span className="settings-icon"><Wifi size={20} /></span>
                    <div>
                      <h3>Connection status</h3>
                      <p className="muted">Current frontend environment.</p>
                    </div>
                  </div>
                  <div className="setting-row">
                    <div><strong>Frontend</strong><p>React + Vite</p></div>
                    <span className="status-pill"><Check size={13} /> Running</span>
                  </div>
                  <div className="setting-row">
                    <div><strong>Backend API</strong><p>Not configured yet</p></div>
                    <span className="status-pill status-demo">Demo mode</span>
                  </div>
                </section>
              </div>
            </>
          )}
        </div>

        <footer className="footer">
          <span>© 2026 ProxiSpeak</span>
          <span><ShieldCheck size={14} /> Designed with privacy in mind</span>
        </footer>
      </main>

      {/* ── Person profile modal ───────────────────────────────────────────── */}
      {selectedPerson && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPerson(null); }}
        >
          <section className="person-modal" role="dialog" aria-modal="true" aria-labelledby="person-modal-title">
            <button className="icon-button modal-close" aria-label="Close profile" onClick={() => setSelectedPerson(null)}>
              <X size={19} />
            </button>
            <Avatar person={selectedPerson} />
            <h2 id="person-modal-title">{selectedPerson.name}</h2>
            <p className="muted">{selectedPerson.status}</p>
            <div className="modal-distance">
              <MapPin size={16} /> {selectedPerson.distance} away <span>·</span> Virtual-office distance
            </div>
            <button className="button button-primary modal-action" onClick={() => connectPerson(selectedPerson)}>
              {connectedPeople.includes(selectedPerson.id)
                ? <><Check size={17} /> Connected · Remove</>
                : <><Users size={17} /> Connect</>}
            </button>
            <p className="footnote">Connecting is currently a local demo action; no invitation is sent to the user.</p>
          </section>
        </div>
      )}

      {/* ── Toast notification ─────────────────────────────────────────────── */}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} /> {notice}
        </div>
      )}
    </div>
  );
}
