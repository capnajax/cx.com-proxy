# Sockets architecture

socket connects, sends a code, the server can accept the new code or node

server needs a resource -- sends a message back to the client to get that resource

client sends an HTTP(S) POST request to send the document asked of it in the socket message. The resource in that requests is cached and an event is fired to alert the server that resource has arrived so it can send it on.

