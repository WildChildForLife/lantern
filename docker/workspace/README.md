# orders-api

A deliberately small service, here so the agent CLIs under test have something
real to read and edit. Every prompt in `docker/prompts/` refers to this code.

Kept tiny on purpose: the point is to produce a transcript containing a tool
call and its result, not to give the model a hard problem.
