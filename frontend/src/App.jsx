
import { useState } from "react";
import {
  Activity,
  AudioLines,
  Bell,
  Check,
  ChevronRight,
  Headphones,
  Home,
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

const initialPeople = [
  { id: 1, name: "Aarav Mehta", initials: "AM", color: "blue", distance: "12 m", status: "In an audio room" },
  { id: 2, name: "Priya Shah", initials: "PS", color: "purple", distance: "28 m", status: "Available" },
  { id: 3, name: "Rohan Kulkarni", initials: "RK", color: "orange", distance: "45 m", status: "Listening" },
  { id: 4, name: "Ananya Rao", initials: "AR", color: "green", distance: "68 m", status: "Available" },
];

const initialRooms = [
  { id: 1, name: "Campus Conversations", category: "Community", people: 8, color: "blue" },
  { id: 2, name: "Music & Chill", category: "Music", people: 5, color: "purple" },
  { id: 3, name: "Tech Talk", category: "Technology", people: 12, color: "orange" },
];

const initialMessages = [
  { id: 1, from: "Priya", text: "Hey! Anyone around for a quick chat?", mine: false },
  { id: 2, from: "You", text: "Hey! Yes, I'm here.", mine: true },
  { id: 3, from: "Priya", text: "Want to join the Campus Conversations room?", mine: false },
];

const navigation = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "nearby", label: "Nearby people", icon: Users },
  { id: "rooms", label: "Audio rooms", icon: Headphones },
  { id: "chat", label: "Messages", icon: MessageCircle },
  { id: "settings", label: "Settings", icon: Settings },
];

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

export default function App() {
  const [activePage, setActivePage] = useState("overview");
  const [people, setPeople] = useState(initialPeople);
  const [rooms, setRooms] = useState(initialRooms);
  const [messages, setMessages] = useState(initialMessages);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [search, setSearch] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [roomSearch, setRoomSearch] = useState("");
  const [micEnabled, setMicEnabled] = useState(false);
  const [muted, setMuted] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [profileName, setProfileName] = useState("Sam");
  const [permission, setPermission] = useState("idle");
  const [micPermission, setMicPermission] = useState("idle");
  const [showNotifications, setShowNotifications] = useState(false);
  const [connectedPeople, setConnectedPeople] = useState([]);
  const [notice, setNotice] = useState("");

  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  };

  async function enableLocation() {
    if (!navigator.geolocation) {
      setPermission("unsupported");
      return;
    }

    setPermission("loading");
    navigator.geolocation.getCurrentPosition(
      () => {
        setPermission("granted");
        showNotice("Location access granted. Live discovery needs backend integration.");
      },
      (error) => {
        setPermission(error.code === 1 ? "denied" : "error");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }

  async function enableMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicPermission("unsupported");
      return;
    }

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

    setMessages((current) => [
      ...current,
      { id: Date.now(), from: "You", text, mine: true },
    ]);
    setChatInput("");
  }

  function addRoom() {
    const name = window.prompt("Enter a name for your audio room:");
    if (!name?.trim()) return;

    const room = {
      id: Date.now(),
      name: name.trim(),
      category: "My room",
      people: 1,
      color: "green",
    };

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

  function renderPerson(person) {
    return (
      <div className="person-row" key={person.id}>
        <div className="person-identity">
          <div className="avatar-wrap">
            <Avatar person={person} />
            <span className={`presence ${person.status === "Available" ? "presence-online" : ""}`} />
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

  return (
    <div className="app-shell">
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
            <div><strong>Your space, your control</strong><p>Manage permissions anytime.</p></div>
          </div>
          <button className="profile-button" onClick={() => setActivePage("settings")}>
            <div className="avatar avatar-profile">{profileName.slice(0, 2).toUpperCase()}</div>
            <div className="profile-copy"><strong>{profileName}</strong><span>My profile</span></div>
            <Settings size={17} />
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="mobile-brand"><AudioLines size={23} /> ProxiSpeak</div>
          <div className="breadcrumb">Workspace <ChevronRight size={14} /> <strong>{pageTitle}</strong></div>
          <div className="topbar-actions">
            <span className="connection-status"><span /> Demo mode</span>
            <div className="notification-wrap">
              <button className="icon-button" aria-label="Notifications" onClick={() => setShowNotifications(!showNotifications)}>
                <Bell size={19} />
              </button>
              {showNotifications && (
                <div className="notification-popover">
                  <strong>Notifications</strong>
                  <p>{notifications ? "You're all caught up." : "Notifications are turned off in settings."}</p>
                  <button className="text-button" onClick={() => { setShowNotifications(false); setActivePage("settings"); }}>Open settings</button>
                </div>
              )}
            </div>
            <div className="avatar avatar-profile top-avatar">{profileName.slice(0, 2).toUpperCase()}</div>
          </div>
        </header>

        <div className="page-content">
          {activePage === "overview" && (
            <>
              <div className="welcome-row">
                <div><p className="eyebrow">YOUR AUDIO COMMUNITY</p><h1>Good to see you, {profileName} <span>✦</span></h1><p className="muted">Discover people, join conversations, and connect in real time.</p></div>
                <button className="button button-primary" onClick={() => setActivePage("nearby")}><Users size={17} /> Explore nearby</button>
              </div>

              <div className="hero-banner">
                <div className="hero-copy">
                  <span className="hero-tag"><Radio size={14} /> PROXIMITY DISCOVERY</span>
                  <h2>Good conversations<br />are closer than you think.</h2>
                  <p>Find people around you and make every nearby moment more connected.</p>
                  <button className="button button-white" onClick={enableLocation}>
                    <MapPin size={17} />
                    {permission === "loading" ? "Requesting access..." : permission === "granted" ? "Location enabled" : "Enable location"}
                  </button>
                  {permission === "denied" && <small className="hero-hint">Access denied. Check your browser's site permissions.</small>}
                  {permission === "unsupported" && <small className="hero-hint">Geolocation isn't supported by this browser.</small>}
                  {permission === "error" && <small className="hero-hint">Couldn't get your location. Try again.</small>}
                </div>
                <div className="hero-visual" aria-hidden="true">
                  <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" />
                  <div className="orbit-center"><AudioLines size={32} /></div>
                  <div className="orbit-avatar orbit-avatar-one">A</div><div className="orbit-avatar orbit-avatar-two">P</div><div className="orbit-avatar orbit-avatar-three">R</div>
                </div>
              </div>

              <div className="stats-grid">
                <div className="stat-card"><span className="stat-icon stat-blue"><Users size={20} /></span><span className="stat-label">Nearby profiles</span><strong>{people.length}</strong><small>Sample profiles</small></div>
                <div className="stat-card"><span className="stat-icon stat-purple"><Headphones size={20} /></span><span className="stat-label">Audio rooms</span><strong>{rooms.length}</strong><small>Demo rooms available</small></div>
                <div className="stat-card"><span className="stat-icon stat-green"><Activity size={20} /></span><span className="stat-label">Your connections</span><strong>{connectedPeople.length}</strong><small>Local demo connections</small></div>
              </div>

              <section className="content-section">
                <SectionTitle eyebrow="DISCOVER" title="People around you" description="Sample profiles to preview the discovery experience." action={<button className="text-button" onClick={() => setActivePage("nearby")}>View all <ChevronRight size={15} /></button>} />
                <div className="panel people-panel">{people.slice(0, 3).map(renderPerson)}</div>
              </section>

              <section className="content-section">
                <SectionTitle eyebrow="TUNE IN" title="Explore audio rooms" description="Find a conversation that interests you." action={<button className="text-button" onClick={() => setActivePage("rooms")}>All rooms <ChevronRight size={15} /></button>} />
                <div className="rooms-grid">{rooms.slice(0, 3).map(renderRoom)}</div>
              </section>
            </>
          )}

          {activePage === "nearby" && (
            <>
              <SectionTitle eyebrow="DISCOVERY" title="Nearby people" description="Explore sample profiles and manage your local demo connections." />
              <div className="permission-banner">
                <MapPin size={20} /><div><strong>{permission === "granted" ? "Location permission granted" : "Location access is optional"}</strong><p>{permission === "granted" ? "Your browser shared location access, but live nearby discovery is not connected yet." : "Allow browser location access to prepare for proximity features."}</p></div>
                <button className="button button-outline" onClick={enableLocation}>{permission === "granted" ? "Check again" : "Enable location"}</button>
              </div>
              <div className="toolbar"><div className="search-box"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people or status..." /></div><span className="muted">{filteredPeople.length} profiles</span></div>
              <div className="panel people-panel">{filteredPeople.length ? filteredPeople.map(renderPerson) : <p className="empty-state">No matching profiles. Try a different search.</p>}</div>
              <p className="footnote"><ShieldCheck size={15} /> Distances and availability are illustrative sample data, not live user locations.</p>
            </>
          )}

          {activePage === "rooms" && (
            <>
              <SectionTitle eyebrow="LISTEN TOGETHER" title="Audio rooms" description="Explore rooms, preview controls, and create a local demo room." action={<button className="button button-primary" onClick={addRoom}><AudioLines size={17} /> Create room</button>} />
              <div className="toolbar"><div className="search-box"><Search size={18} /><input value={roomSearch} onChange={(e) => setRoomSearch(e.target.value)} placeholder="Search audio rooms..." /></div><span className="muted">{filteredRooms.length} rooms</span></div>
              <div className="rooms-grid">{filteredRooms.map(renderRoom)}</div>
              {filteredRooms.length === 0 && <p className="empty-state">No rooms match your search.</p>}
              {selectedRoom && (
                <section className="panel active-room">
                  <div className="active-room-heading"><div><p className="eyebrow">NOW SELECTED</p><h2>{selectedRoom.name}</h2><p className="muted">Audio controls preview — live room audio is not connected.</p></div><button className="icon-button" aria-label="Close room" onClick={() => setSelectedRoom(null)}><X size={18} /></button></div>
                  <div className="audio-visualizer">{Array.from({ length: 35 }, (_, i) => <span key={i} style={{ "--bar": `${12 + ((i * 17 + 13) % 42)}px` }} />)}</div>
                  <div className="audio-controls">
                    <button className={`audio-control ${micEnabled ? "control-on" : ""}`} onClick={() => setMicEnabled(!micEnabled)}>{micEnabled ? <Mic size={19} /> : <MicOff size={19} />}<span>{micEnabled ? "Mic preview on" : "Mic off"}</span></button>
                    <button className="audio-control" onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={19} /> : <Volume2 size={19} />}<span>{muted ? "Muted" : "Unmuted"}</span></button>
                    <button className="button button-outline" onClick={() => setSelectedRoom(null)}>Leave preview</button>
                  </div>
                  <p className="footnote">These controls change the interface only. They don't publish audio or connect to other listeners.</p>
                </section>
              )}
            </>
          )}

          {activePage === "chat" && (
            <>
              <SectionTitle eyebrow="STAY CONNECTED" title="Messages" description="A local chat preview. Messages are not sent to other users." />
              <div className="chat-layout panel">
                <div className="chat-contact-list"><h3>Conversations</h3><button className="chat-contact selected-contact"><Avatar person={initialPeople[1]} small /><span><strong>Priya Shah</strong><small>Demo conversation</small></span><span className="contact-dot" /></button><p className="chat-disclaimer">This is sample content. Real conversations need backend messaging.</p></div>
                <div className="chat-conversation">
                  <div className="chat-header"><Avatar person={initialPeople[1]} small /><div><strong>Priya Shah</strong><small><span className="presence-dot" /> Sample conversation</small></div></div>
                  <div className="message-list">{messages.map((message) => <div className={`message ${message.mine ? "message-mine" : ""}`} key={message.id}><span>{message.from}</span><p>{message.text}</p></div>)}</div>
                  <form className="chat-form" onSubmit={sendMessage}><input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Write a demo message..." aria-label="Message" /><button className="button button-primary" type="submit" aria-label="Send message"><Send size={17} /></button></form>
                </div>
              </div>
            </>
          )}

          {activePage === "settings" && (
            <>
              <SectionTitle eyebrow="YOUR ACCOUNT" title="Settings" description="Manage your profile, permissions, and app preferences." />
              <div className="settings-grid">
                <section className="panel settings-card"><div className="settings-heading"><span className="settings-icon"><Users size={20} /></span><div><h3>Your profile</h3><p className="muted">Choose how you appear in ProxiSpeak.</p></div></div><label className="field-label" htmlFor="profile-name">Display name</label><input id="profile-name" className="field-input" value={profileName} onChange={(e) => setProfileName(e.target.value)} maxLength={30} /><p className="footnote">This name is stored only in the current page session.</p></section>
                <section className="panel settings-card"><div className="settings-heading"><span className="settings-icon"><ShieldCheck size={20} /></span><div><h3>Permissions</h3><p className="muted">Browser permissions are requested only when you ask.</p></div></div><div className="setting-row"><div><strong><MapPin size={16} /> Location</strong><p>{permission === "granted" ? "Permission granted" : permission === "denied" ? "Permission denied" : "Not requested"}</p></div><button className="button button-outline button-small" onClick={enableLocation}>Request</button></div><div className="setting-row"><div><strong><Mic size={16} /> Microphone</strong><p>{micPermission === "granted" ? "Permission granted" : micPermission === "denied" ? "Permission denied" : "Not requested"}</p></div><button className="button button-outline button-small" onClick={enableMicrophone}>Test access</button></div><p className="footnote">Microphone access is checked and immediately released. Live audio is not transmitted.</p></section>
                <section className="panel settings-card"><div className="settings-heading"><span className="settings-icon"><Bell size={20} /></span><div><h3>Preferences</h3><p className="muted">Customize your experience.</p></div></div><div className="setting-row"><div><strong>Notifications</strong><p>Show in-app notification status</p></div><button className={`toggle ${notifications ? "toggle-on" : ""}`} role="switch" aria-checked={notifications} aria-label="Toggle notifications" onClick={() => setNotifications(!notifications)}><span /></button></div><div className="setting-row"><div><strong>Audio preview</strong><p>Start room previews muted</p></div><button className={`toggle ${muted ? "toggle-on" : ""}`} role="switch" aria-checked={muted} aria-label="Toggle muted preview" onClick={() => setMuted(!muted)}><span /></button></div></section>
                <section className="panel settings-card"><div className="settings-heading"><span className="settings-icon"><Wifi size={20} /></span><div><h3>Connection status</h3><p className="muted">Current frontend environment.</p></div></div><div className="setting-row"><div><strong>Frontend</strong><p>React + Vite</p></div><span className="status-pill"><Check size={13} /> Running</span></div><div className="setting-row"><div><strong>Backend API</strong><p>Not configured yet</p></div><span className="status-pill status-demo">Demo mode</span></div></section>
              </div>
            </>
          )}
        </div>
        <footer className="footer"><span>© 2026 ProxiSpeak</span><span><ShieldCheck size={14} /> Designed with privacy in mind</span></footer>
      </main>

      {selectedPerson && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPerson(null); }}>
          <section className="person-modal" role="dialog" aria-modal="true" aria-labelledby="person-modal-title">
            <button className="icon-button modal-close" aria-label="Close profile" onClick={() => setSelectedPerson(null)}><X size={19} /></button>
            <Avatar person={selectedPerson} />
            <h2 id="person-modal-title">{selectedPerson.name}</h2>
            <p className="muted">{selectedPerson.status}</p>
            <div className="modal-distance"><MapPin size={16} /> {selectedPerson.distance} away <span>·</span> Sample data</div>
            <button className="button button-primary modal-action" onClick={() => connectPerson(selectedPerson)}>
              {connectedPeople.includes(selectedPerson.id) ? <><Check size={17} /> Connected · Remove</> : <><Users size={17} /> Connect</>}
            </button>
            <p className="footnote">This is a demo profile. No invitation is sent to a real person.</p>
          </section>
        </div>
      )}
      {notice && <div className="toast" role="status"><Check size={17} /> {notice}</div>}
    </div>
  );
}
