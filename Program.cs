using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using StackExchange.Redis;
using RedisChatApp.Hubs;
using RedisChatApp.Services;
using RedisChatApp.Data;
using RedisChatApp.Models;
using System.IO;
using System.Linq;

var builder = WebApplication.CreateBuilder(args);

// Redis bağlantısı: appsettings'ten al
var redisConn = builder.Configuration["Redis:ConnectionString"] ?? "localhost:6379,abortConnect=false";
builder.Services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(redisConn));

// EF Core + Identity
builder.Services.AddDbContext<AppDbContext>(options =>
	options.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=chat.db"));
builder.Services.AddIdentity<ApplicationUser, IdentityRole>(options =>
	{
		options.Password.RequireNonAlphanumeric = false;
		options.Password.RequireUppercase = false;
		options.Password.RequireDigit = false;
		options.Password.RequiredLength = 6;
	})
	.AddEntityFrameworkStores<AppDbContext>()
	.AddDefaultTokenProviders();
builder.Services.AddHttpContextAccessor();

// Data Protection key persistence (persist across container restarts)
// If running in container with /data volume, store keys under /data/keys
try
{
	const string keysRoot = "/data";
	if (Directory.Exists(keysRoot))
	{
		var keysPath = Path.Combine(keysRoot, "keys");
		Directory.CreateDirectory(keysPath);
		builder.Services.AddDataProtection()
			.PersistKeysToFileSystem(new DirectoryInfo(keysPath))
			.SetApplicationName("RedisChatApp");
	}
}
catch { /* ignore, fallback to default location */ }

// SignalR
builder.Services.AddSignalR();
// Redis background subscriber
builder.Services.AddHostedService<ChatRedisSubscriber>();
builder.Services.AddSingleton<EmailService>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
	app.UseDeveloperExceptionPage();
}

// wwwroot'tan statik dosyalar
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

// Hub endpoint
app.MapHub<ChatHub>("/chat");

// Minimal API: Auth
app.MapPost("/api/auth/register", async (UserManager<ApplicationUser> userManager, RegisterRequest req, IHubContext<ChatHub> hub) =>
{
	var user = new ApplicationUser { UserName = req.email, Email = req.email, DisplayName = req.displayName };
	var result = await userManager.CreateAsync(user, req.password);
	if (result.Succeeded)
	{
		// Tüm bağlı kullanıcılara yeni üye bildirimi (sayfa yenilemeden liste güncellensin)
		await hub.Clients.All.SendAsync("UserRegistered", new { user.Id, user.Email, user.DisplayName });
		return Results.Ok();
	}
	return Results.BadRequest(result.Errors);
});

app.MapPost("/api/auth/login", async (SignInManager<ApplicationUser> signInManager, LoginRequest req) =>
{
	var result = await signInManager.PasswordSignInAsync(req.email, req.password, isPersistent: true, lockoutOnFailure: false);
	return result.Succeeded ? Results.Ok() : Results.Unauthorized();
});

app.MapPost("/api/auth/logout", async (SignInManager<ApplicationUser> signInManager) =>
{
	await signInManager.SignOutAsync();
	return Results.Ok();
});

// Password reset: send a simple rule to user's email
app.MapPost("/api/auth/forgot", async (UserManager<ApplicationUser> userManager, EmailService mail, ForgotPasswordRequest req) =>
{
	var user = await userManager.FindByEmailAsync(req.email);
	if (user == null) return Results.Ok(); // do not reveal
	// Simple temporary password by rule: first 3 of email + "@" + last 3 reversed (demo only)
	var local = req.email.Split('@')[0];
	var temp = (local.Length >= 3 ? local[..3] : local) + "@" + new string((local.Length >= 3 ? local[^3..] : local).ToCharArray().Reverse().ToArray());
	if (temp.Length < 6) temp = temp + "123";
	var token = await userManager.GeneratePasswordResetTokenAsync(user);
	var result = await userManager.ResetPasswordAsync(user, token, temp);
	if (result.Succeeded)
	{
		await mail.SendAsync(user.Email!, "Joker Chat - Geçici Şifre", $"Geçici şifreniz: {temp}\nLütfen giriş yapıp şifrenizi değiştirin.");
		return Results.Ok();
	}
	return Results.BadRequest(result.Errors);
});

app.MapGet("/api/auth/me", async (UserManager<ApplicationUser> userManager, IHttpContextAccessor accessor) =>
{
	var me = await userManager.GetUserAsync(accessor.HttpContext!.User);
	if (me == null) return Results.Unauthorized();
	return Results.Ok(new { me.Id, me.Email, me.DisplayName });
}).RequireAuthorization();

// Minimal API: Users & Friends
app.MapGet("/api/users", (UserManager<ApplicationUser> userManager, AppDbContext db) =>
{
	var users = userManager.Users.Select(u => new { u.Id, u.Email, u.DisplayName }).ToList();
	var ids = users.Select(u => u.Id).ToList();
	var avatars = db.UserProfiles.Where(p => ids.Contains(p.UserId))
		.ToDictionary(p => p.UserId, p => p.AvatarUrl);
	var result = users.Select(u => new { u.Id, u.Email, u.DisplayName, AvatarUrl = avatars.ContainsKey(u.Id) ? avatars[u.Id] : null });
	return Results.Ok(result);
}).RequireAuthorization();

app.MapGet("/api/friends", async (AppDbContext db, UserManager<ApplicationUser> userManager, IHttpContextAccessor accessor) =>
{
	var me = await userManager.GetUserAsync(accessor.HttpContext!.User);
	if (me == null) return Results.Unauthorized();
	var friendIds = db.FriendRequests
		.Where(f => (f.FromUserId == me.Id || f.ToUserId == me.Id) && f.Status == FriendRequestStatus.Accepted)
		.Select(f => f.FromUserId == me.Id ? f.ToUserId : f.FromUserId)
		.ToList();
	var friends = userManager.Users
		.Where(u => friendIds.Contains(u.Id))
		.Select(u => new { u.Id, u.Email, u.DisplayName })
		.ToList();
	var avatars = db.UserProfiles.Where(p => friendIds.Contains(p.UserId))
		.ToDictionary(p => p.UserId, p => p.AvatarUrl);
	var result = friends.Select(u => new { u.Id, u.Email, u.DisplayName, AvatarUrl = avatars.ContainsKey(u.Id) ? avatars[u.Id] : null });
	return Results.Ok(result);
}).RequireAuthorization();

app.MapGet("/api/friends/requests", async (AppDbContext db, UserManager<ApplicationUser> userManager, IHttpContextAccessor accessor) =>
{
	var me = await userManager.GetUserAsync(accessor.HttpContext!.User);
	if (me == null) return Results.Unauthorized();
	var pendingIncoming = db.FriendRequests
		.Where(f => f.ToUserId == me.Id && f.Status == FriendRequestStatus.Pending)
		.ToList();
	var pendingOutgoing = db.FriendRequests
		.Where(f => f.FromUserId == me.Id && f.Status == FriendRequestStatus.Pending)
		.ToList();
	return Results.Ok(new { incoming = pendingIncoming, outgoing = pendingOutgoing });
}).RequireAuthorization();

app.MapPost("/api/friends/request", async (AppDbContext db, UserManager<ApplicationUser> userManager, IHttpContextAccessor accessor, IHubContext<ChatHub> hub, FriendRequestCreate req) =>
{
	var me = await userManager.GetUserAsync(accessor.HttpContext!.User);
	if (me == null) return Results.Unauthorized();
	if (me.Id == req.toUserId) return Results.BadRequest("Kendinize istek atamazsınız.");
	var exists = db.FriendRequests.Any(f => f.FromUserId == me.Id && f.ToUserId == req.toUserId && f.Status == FriendRequestStatus.Pending);
	if (exists) return Results.BadRequest("Zaten bekleyen istek var.");
	db.FriendRequests.Add(new FriendRequest { FromUserId = me.Id, ToUserId = req.toUserId });
	await db.SaveChangesAsync();
	// Hedef kullanıcıya gerçek zamanlı bildirim, gönderen tarafa da outbound güncellemesi
	await hub.Clients.User(req.toUserId).SendAsync("FriendRequestIncoming", me.Id);
	await hub.Clients.User(me.Id).SendAsync("FriendRequestOutgoing", req.toUserId);
	return Results.Ok();
}).RequireAuthorization();

app.MapPost("/api/friends/respond", async (AppDbContext db, UserManager<ApplicationUser> userManager, IHttpContextAccessor accessor, IHubContext<ChatHub> hub, FriendRespondRequest req) =>
{
	var me = await userManager.GetUserAsync(accessor.HttpContext!.User);
	if (me == null) return Results.Unauthorized();
	var fr = await db.FriendRequests.FindAsync(req.requestId);
	if (fr == null || fr.ToUserId != me.Id) return Results.NotFound();
	fr.Status = req.accept ? FriendRequestStatus.Accepted : FriendRequestStatus.Rejected;
	await db.SaveChangesAsync();
	// Her iki tarafa da gerçek zamanlı güncelleme
	if (req.accept)
	{
		await hub.Clients.User(fr.FromUserId).SendAsync("FriendRequestAccepted", fr.ToUserId);
		await hub.Clients.User(fr.ToUserId).SendAsync("FriendRequestAccepted", fr.FromUserId);
	}
	else
	{
		await hub.Clients.User(fr.FromUserId).SendAsync("FriendRequestRejected", fr.ToUserId);
		await hub.Clients.User(fr.ToUserId).SendAsync("FriendRequestRejected", fr.FromUserId);
	}
	return Results.Ok();
}).RequireAuthorization();

// User profile by id (for viewing friends)
app.MapGet("/api/users/{id}", (UserManager<ApplicationUser> userManager, AppDbContext db, string id) =>
{
	var user = userManager.Users.Where(u => u.Id == id)
		.Select(u => new { u.Id, u.Email, u.DisplayName, u.PhoneNumber })
		.FirstOrDefault();
	if (user is null) return Results.NotFound();
	var prof = db.UserProfiles.FirstOrDefault(p => p.UserId == id);
	var phoneVisible = (prof?.PhonePublic ?? false) ? user.PhoneNumber : null;
	var addressVisible = (prof?.AddressPublic ?? false) ? prof?.Address : null;
	return Results.Ok(new
	{
		user.Id,
		user.Email,
		user.DisplayName,
		PhoneNumber = phoneVisible,
		Profile = new
		{
			AvatarUrl = prof?.AvatarUrl,
			Gender = prof?.Gender,
			Address = addressVisible,
			Education = prof?.Education,
			PhonePublic = prof?.PhonePublic ?? false,
			AddressPublic = prof?.AddressPublic ?? false
		}
	});
}).RequireAuthorization();

// Profile (me)
app.MapGet("/api/profile", async (UserManager<ApplicationUser> userManager, IHttpContextAccessor accessor, AppDbContext db) =>
{
	var me = await userManager.GetUserAsync(accessor.HttpContext!.User);
	if (me == null) return Results.Unauthorized();
	var prof = db.UserProfiles.FirstOrDefault(p => p.UserId == me.Id);
	return Results.Ok(new { me.Id, me.Email, me.DisplayName, me.PhoneNumber, Profile = prof });
}).RequireAuthorization();

app.MapPost("/api/profile", async (UserManager<ApplicationUser> userManager, IHttpContextAccessor accessor, AppDbContext db, UpdateProfileRequest body) =>
{
	var me = await userManager.GetUserAsync(accessor.HttpContext!.User);
	if (me == null) return Results.Unauthorized();
	me.DisplayName = body.DisplayName ?? me.DisplayName;
	me.PhoneNumber = body.PhoneNumber ?? me.PhoneNumber;
	var result = await userManager.UpdateAsync(me);
	if (!result.Succeeded) return Results.BadRequest(result.Errors);

	var prof = db.UserProfiles.FirstOrDefault(p => p.UserId == me.Id) ?? new UserProfile { UserId = me.Id };
	if (body.Profile != null)
	{
		prof.AvatarUrl = body.Profile.AvatarUrl ?? prof.AvatarUrl;
		prof.Gender = body.Profile.Gender ?? prof.Gender;
		prof.Address = body.Profile.Address ?? prof.Address;
		prof.Education = body.Profile.Education ?? prof.Education;
		prof.PhonePublic = body.Profile.PhonePublic;
		prof.AddressPublic = body.Profile.AddressPublic;
	}
	if (prof.Id == 0) db.UserProfiles.Add(prof);
	await db.SaveChangesAsync();
	return Results.Ok();
}).RequireAuthorization();

app.MapPost("/api/profile/password", async (UserManager<ApplicationUser> userManager, IHttpContextAccessor accessor, PasswordChangeRequest body) =>
{
	var me = await userManager.GetUserAsync(accessor.HttpContext!.User);
	if (me == null) return Results.Unauthorized();
	var result = await userManager.ChangePasswordAsync(me, body.currentPassword, body.newPassword);
	return result.Succeeded ? Results.Ok() : Results.BadRequest(result.Errors);
}).RequireAuthorization();

// Blocking
app.MapGet("/api/friends/blocks", async (AppDbContext db, UserManager<ApplicationUser> userManager, IHttpContextAccessor accessor) =>
{
	var me = await userManager.GetUserAsync(accessor.HttpContext!.User);
	if (me == null) return Results.Unauthorized();
	var blocks = db.FriendBlocks.Where(b => b.BlockerUserId == me.Id).Select(b => b.BlockedUserId).ToList();
	return Results.Ok(blocks);
}).RequireAuthorization();

app.MapPost("/api/friends/block", async (AppDbContext db, UserManager<ApplicationUser> userManager, IHttpContextAccessor accessor, IdRequest body) =>
{
	var me = await userManager.GetUserAsync(accessor.HttpContext!.User);
	if (me == null) return Results.Unauthorized();
	if (!db.FriendBlocks.Any(b => b.BlockerUserId == me.Id && b.BlockedUserId == body.userId))
		db.FriendBlocks.Add(new RedisChatApp.Models.FriendBlock { BlockerUserId = me.Id, BlockedUserId = body.userId });
	await db.SaveChangesAsync();
	return Results.Ok();
}).RequireAuthorization();

app.MapPost("/api/friends/unblock", async (AppDbContext db, UserManager<ApplicationUser> userManager, IHttpContextAccessor accessor, IdRequest body) =>
{
	var me = await userManager.GetUserAsync(accessor.HttpContext!.User);
	if (me == null) return Results.Unauthorized();
	var blocks = db.FriendBlocks.Where(b => b.BlockerUserId == me.Id && b.BlockedUserId == body.userId);
	db.FriendBlocks.RemoveRange(blocks);
	await db.SaveChangesAsync();
	return Results.Ok();
}).RequireAuthorization();

#region Friend Management


// Remove friend (unfriend)
app.MapPost("/api/friends/remove", async (AppDbContext db, UserManager<ApplicationUser> userManager, IHttpContextAccessor accessor, IdRequest body) =>
{
	var me = await userManager.GetUserAsync(accessor.HttpContext!.User);
	if (me == null) return Results.Unauthorized();
	var accepted = db.FriendRequests.Where(f => ((f.FromUserId == me.Id && f.ToUserId == body.userId) || (f.FromUserId == body.userId && f.ToUserId == me.Id)) && f.Status == FriendRequestStatus.Accepted);
	db.RemoveRange(accepted);
	await db.SaveChangesAsync();
	return Results.Ok();
}).RequireAuthorization();
#endregion

// Messages: list conversation (excluding messages deleted by caller)
app.MapGet("/api/messages/{otherId}", async (AppDbContext db, UserManager<ApplicationUser> userManager, IHttpContextAccessor accessor, string otherId) =>
{
	var me = await userManager.GetUserAsync(accessor.HttpContext!.User);
	if (me == null) return Results.Unauthorized();
	var list = db.ChatMessages
		.Where(m => ((m.FromUserId == me.Id && m.ToUserId == otherId) && !m.IsDeletedBySender)
				 || ((m.FromUserId == otherId && m.ToUserId == me.Id) && !m.IsDeletedByRecipient))
		.OrderBy(m => m.SentAt)
		.Select(m => new { m.Id, m.FromUserId, m.ToUserId, m.Content, m.SentAt })
		.ToList();
	return Results.Ok(list);
}).RequireAuthorization();

// Messages: soft delete (for caller side)
app.MapPost("/api/messages/{id}/delete", async (AppDbContext db, UserManager<ApplicationUser> userManager, IHttpContextAccessor accessor, long id) =>
{
	var me = await userManager.GetUserAsync(accessor.HttpContext!.User);
	if (me == null) return Results.Unauthorized();
	var msg = await db.ChatMessages.FindAsync(id);
	if (msg == null) return Results.NotFound();
	if (msg.FromUserId == me.Id) msg.IsDeletedBySender = true;
	else if (msg.ToUserId == me.Id) msg.IsDeletedByRecipient = true;
	else return Results.Forbid();
	await db.SaveChangesAsync();
	return Results.Ok();
}).RequireAuthorization();

// DB init (EnsureCreated for demo simplicity)
using (var scope = app.Services.CreateScope())
{
	var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
	await db.Database.EnsureCreatedAsync();
	// Ensure new tables exist for existing dev DBs (SQLite only)
	if (db.Database.IsSqlite())
	{
		db.Database.ExecuteSqlRaw(@"
CREATE TABLE IF NOT EXISTS FriendBlocks (
	Id INTEGER NOT NULL CONSTRAINT PK_FriendBlocks PRIMARY KEY AUTOINCREMENT,
	BlockerUserId TEXT NOT NULL,
	BlockedUserId TEXT NOT NULL
);
");
		db.Database.ExecuteSqlRaw(@"
CREATE TABLE IF NOT EXISTS ChatMessages (
	Id INTEGER NOT NULL CONSTRAINT PK_ChatMessages PRIMARY KEY AUTOINCREMENT,
	FromUserId TEXT NOT NULL,
	ToUserId TEXT NOT NULL,
	Content TEXT NOT NULL,
	SentAt TEXT NOT NULL,
	IsDeletedBySender INTEGER NOT NULL DEFAULT 0,
	IsDeletedByRecipient INTEGER NOT NULL DEFAULT 0
);
");
		db.Database.ExecuteSqlRaw(@"
CREATE TABLE IF NOT EXISTS UserProfiles (
	Id INTEGER NOT NULL CONSTRAINT PK_UserProfiles PRIMARY KEY AUTOINCREMENT,
	UserId TEXT NOT NULL,
	AvatarUrl TEXT NULL,
	Gender TEXT NULL,
	Address TEXT NULL,
	Education TEXT NULL,
	PhonePublic INTEGER NOT NULL DEFAULT 0,
	AddressPublic INTEGER NOT NULL DEFAULT 0
);
");
	}
}

app.Run();
