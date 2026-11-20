// localStorage that never throws (private mode, blocked storage). Used ONLY for signed-in players' preferences and
// their offline retry queue. Guest play never writes anything here.
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  remove(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};
