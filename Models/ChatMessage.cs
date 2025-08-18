using System.ComponentModel.DataAnnotations;

namespace RedisChatApp.Models
{
    public class ChatMessage
    {
        [Key]
        public long Id { get; set; }
        [Required]
        public string FromUserId { get; set; } = default!;
        [Required]
        public string ToUserId { get; set; } = default!;
        [Required]
        public string Content { get; set; } = default!;
        public DateTime SentAt { get; set; } = DateTime.UtcNow;
        public bool IsDeletedBySender { get; set; }
        public bool IsDeletedByRecipient { get; set; }
    }
}
